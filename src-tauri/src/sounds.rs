//! UUID sound files are accessed only while AppStorage's sound gate is held.
use std::{
    collections::HashSet,
    fs::{self, File, OpenOptions},
    io::{self, Read, Write},
    path::{Path, PathBuf},
};

pub(crate) const MAX_CUSTOM_SOUND_BYTES: usize = 8 * 1024 * 1024;

pub(crate) fn valid_wav(bytes: &[u8]) -> bool {
    if bytes.len() < 12
        || bytes.len() > MAX_CUSTOM_SOUND_BYTES
        || &bytes[0..4] != b"RIFF"
        || &bytes[8..12] != b"WAVE"
    {
        return false;
    }
    let total = u32::from_le_bytes([bytes[4], bytes[5], bytes[6], bytes[7]]) as usize + 8;
    if total != bytes.len() {
        return false;
    }
    let (mut offset, mut format, mut data) = (12usize, false, false);
    while offset + 8 <= total {
        let size = u32::from_le_bytes([
            bytes[offset + 4],
            bytes[offset + 5],
            bytes[offset + 6],
            bytes[offset + 7],
        ]) as usize;
        let Some(end) = offset
            .checked_add(8)
            .and_then(|value| value.checked_add(size))
        else {
            return false;
        };
        if end > total {
            return false;
        }
        if &bytes[offset..offset + 4] == b"fmt " && size >= 16 {
            format = true;
        }
        if &bytes[offset..offset + 4] == b"data" && size > 0 {
            data = true;
        }
        offset = end + (size % 2);
    }
    format && data && offset == total
}

pub(crate) fn sound_path(root: &Path, id: &str) -> io::Result<PathBuf> {
    let id = uuid::Uuid::parse_str(id).map_err(|_| io::Error::other("Invalid sound ID"))?;
    Ok(root.join(format!("{id}.wav")))
}

fn check_root(root: &Path, create: bool) -> io::Result<()> {
    if create {
        match fs::create_dir(root) {
            Ok(()) => {
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    fs::set_permissions(root, fs::Permissions::from_mode(0o700))?;
                }
            }
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
            Err(error) => return Err(error),
        }
    }
    let metadata = fs::symlink_metadata(root)?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err(io::Error::other(
            "The sound folder is not an owned directory",
        ));
    }
    Ok(())
}

pub(crate) fn write(root: &Path, id: &str, bytes: &[u8]) -> io::Result<()> {
    if !valid_wav(bytes) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Choose a valid WAV file no larger than 8 MB.",
        ));
    }
    check_root(root, true)?;
    let path = sound_path(root, id)?;
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(&path)?;
    let result = file.write_all(bytes).and_then(|()| file.sync_all());
    drop(file);
    if let Err(error) = result {
        if let Err(cleanup) = fs::remove_file(&path) {
            return Err(io::Error::other(format!(
                "Sound write failed: {error}; partial file cleanup failed: {cleanup}"
            )));
        }
        return Err(error);
    }
    // Persist the directory entry before SQLite can start referring to this file.
    File::open(root)?.sync_all()
}

pub(crate) fn read(root: &Path, id: &str) -> io::Result<Vec<u8>> {
    check_root(root, false)?;
    let path = sound_path(root, id)?;
    let metadata = fs::symlink_metadata(&path)?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err(io::Error::other("That sound is not a regular file"));
    }
    let file = File::open(&path)?;
    let opened = file.metadata()?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let current = fs::symlink_metadata(&path)?;
        if current.file_type().is_symlink()
            || current.dev() != opened.dev()
            || current.ino() != opened.ino()
        {
            return Err(io::Error::other("That sound changed while opening"));
        }
    }
    if !opened.is_file() || opened.len() > MAX_CUSTOM_SOUND_BYTES as u64 {
        return Err(io::Error::other("That sound is too large or unavailable"));
    }
    let mut bytes = Vec::with_capacity(opened.len() as usize);
    file.take(MAX_CUSTOM_SOUND_BYTES as u64 + 1)
        .read_to_end(&mut bytes)?;
    if !valid_wav(&bytes) {
        return Err(io::Error::other("That sound is not a supported WAV file"));
    }
    Ok(bytes)
}

/// Fail closed before deleting anything if the directory or reference scan is unavailable.
/// Never traverse directories, noncanonical filenames, symlinks, or nonregular files.
pub(crate) fn reconcile(root: &Path, retained: &HashSet<String>) -> io::Result<()> {
    match check_root(root, false) {
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
        result => result?,
    }
    let mut unreferenced = Vec::new();
    for entry in fs::read_dir(root)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        if !file_type.is_file() || file_type.is_symlink() {
            continue;
        }
        let name = entry.file_name();
        let Some(id) = name.to_str().and_then(|name| name.strip_suffix(".wav")) else {
            continue;
        };
        let Ok(uuid) = uuid::Uuid::parse_str(id) else {
            continue;
        };
        if uuid.to_string() != id || retained.contains(id) {
            continue;
        }
        unreferenced.push(entry.path());
    }
    for path in unreferenced {
        fs::remove_file(path)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    const WAV: &[u8] = include_bytes!("../../public/sounds/back.wav");

    #[test]
    fn wav_validation_and_exclusive_private_write() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().join("sounds");
        let id = uuid::Uuid::new_v4().to_string();
        assert!(!valid_wav(b"not a WAV"));
        assert!(valid_wav(WAV));
        write(&root, &id, WAV).unwrap();
        assert!(write(&root, &id, WAV).is_err());
        assert_eq!(read(&root, &id).unwrap(), WAV);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(sound_path(&root, &id).unwrap())
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o600
            );
        }
    }

    #[test]
    fn reconciliation_only_removes_unreferenced_canonical_uuid_regular_files() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().join("sounds");
        let kept = uuid::Uuid::new_v4().to_string();
        let orphan = uuid::Uuid::new_v4().to_string();
        write(&root, &kept, WAV).unwrap();
        write(&root, &orphan, WAV).unwrap();
        fs::write(root.join("user.wav"), WAV).unwrap();
        fs::create_dir(root.join(format!("{}.wav", uuid::Uuid::new_v4()))).unwrap();
        reconcile(&root, &HashSet::from([kept.clone()])).unwrap();
        assert!(sound_path(&root, &kept).unwrap().exists());
        assert!(!sound_path(&root, &orphan).unwrap().exists());
        assert!(root.join("user.wav").exists());
        assert!(sound_path(&root, "../outside").is_err());
    }

    #[cfg(unix)]
    #[test]
    fn symlinks_never_escape_the_owned_folder() {
        use std::os::unix::fs::symlink;
        let directory = tempfile::tempdir().unwrap();
        let outside = directory.path().join("outside.wav");
        fs::write(&outside, WAV).unwrap();
        let root = directory.path().join("sounds");
        fs::create_dir(&root).unwrap();
        let id = uuid::Uuid::new_v4().to_string();
        let link = sound_path(&root, &id).unwrap();
        symlink(&outside, &link).unwrap();
        assert!(read(&root, &id).is_err());
        reconcile(&root, &HashSet::new()).unwrap();
        assert!(fs::symlink_metadata(link).unwrap().file_type().is_symlink());
        assert_eq!(fs::read(&outside).unwrap(), WAV);
        let linked_root = directory.path().join("linked-sounds");
        symlink(&root, &linked_root).unwrap();
        assert!(reconcile(&linked_root, &HashSet::new()).is_err());
        assert!(write(&linked_root, &uuid::Uuid::new_v4().to_string(), WAV).is_err());
    }
}
