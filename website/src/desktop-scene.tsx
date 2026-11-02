import {
  CalendarDays,
  Folder,
  Settings,
  Compass,
  StickyNote,
  Wifi,
  BatteryFull,
} from "lucide-react"

export function DesktopScene({
  style,
  dismissed,
  closing,
  replay,
  onDismiss,
  onDismissComplete,
}: {
  style: "fullscreen" | "notch" | "native"
  dismissed: boolean
  closing: boolean
  replay: number
  onDismiss: () => void
  onDismissComplete: () => void
}) {
  return (
    <div className="desktop-camera" data-view={style}>
      <div className="desktop-menubar" aria-hidden="true">
        <div>
          <strong>Finder</strong>
          <span>File</span>
          <span>Edit</span>
          <span>View</span>
          <span>Go</span>
          <span>Window</span>
        </div>
        <div>
          <img src="/favicon.png" alt="" />
          <Wifi />
          <BatteryFull />
          <span>9:41</span>
        </div>
      </div>
      <div className="desktop-wallpaper" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
      <div className="desktop-dock" aria-hidden="true">
        {[Folder, Compass, CalendarDays, StickyNote, Settings].map(
          (Icon, index) => (
            <span key={index}>
              <Icon />
            </span>
          )
        )}
        <img src="/favicon.png" alt="" />
      </div>
      <div className="desktop-widgets" aria-hidden="true">
        <div className="desktop-clock">
          <i />
          <i />
        </div>
        <div className="desktop-calendar">
          <span>A little space</span>
          <strong>to remember.</strong>
        </div>
      </div>
      {!dismissed && (
        <div
          key={`${style}-${replay}`}
          data-closing={closing}
          className={`desktop-alert desktop-alert-${style}`}
          onTransitionEnd={(event) => {
            if (
              closing &&
              event.target === event.currentTarget &&
              event.propertyName === "opacity"
            ) {
              onDismissComplete()
            }
          }}
        >
          {style === "native" ? (
            <div className="desktop-notification-brand">
              <img src="/favicon.png" alt="" />
              <strong>Sela</strong>
              <span>now</span>
            </div>
          ) : (
            <p className="desktop-alert-kicker">
              Preview — nothing will change
            </p>
          )}
          <h2>Your reminder shows up right here.</h2>
          <button type="button" className="desktop-dismiss" onClick={onDismiss}>
            Close preview
          </button>
        </div>
      )}
    </div>
  )
}
