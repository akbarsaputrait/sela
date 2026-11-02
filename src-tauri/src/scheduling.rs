//! Calendar-based scheduling in a persistent IANA time zone.
//!
//! `date` is the inclusive lower bound for every kind. Validation requires at
//! least one occurrence strictly after `now_ms`; an initial local datetime in a
//! gap or fold is always rejected. Later gap/fold occurrences are skipped.

use chrono::{Datelike, LocalResult, NaiveDate, NaiveTime, TimeZone, Utc};
use chrono_tz::Tz;
use serde::{Deserialize, Serialize};
use std::str::FromStr;

const MAX_DATES: usize = 10_000;
// Searching from the query's local date, rather than from the start date, keeps
// old schedules cheap. This also bounds work even for pathological zone data.
const MAX_SCAN_DAYS: usize = 3_700;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ScheduleKind {
    Once,
    Daily,
    Weekdays,
    Dates,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Schedule {
    pub kind: ScheduleKind,
    pub date: String,
    pub time: String,
    pub weekdays: Vec<u32>,
    pub dates: Vec<String>,
    pub end_date: Option<String>,
    pub time_zone: String,
}

fn parse_date(value: &str) -> Result<NaiveDate, String> {
    if value.len() != 10 || !value.is_ascii() {
        return Err(format!("invalid date: {value}"));
    }
    let date = NaiveDate::parse_from_str(value, "%Y-%m-%d")
        .map_err(|_| format!("invalid date: {value}"))?;
    if date.year() < 1 || date.format("%Y-%m-%d").to_string() != value {
        return Err(format!("invalid date: {value}"));
    }
    Ok(date)
}

fn parse_time(value: &str) -> Result<NaiveTime, String> {
    if value.len() != 5 || !value.is_ascii() {
        return Err(format!("invalid time: {value}"));
    }
    let time =
        NaiveTime::parse_from_str(value, "%H:%M").map_err(|_| format!("invalid time: {value}"))?;
    if time.format("%H:%M").to_string() != value {
        return Err(format!("invalid time: {value}"));
    }
    Ok(time)
}

fn timestamp(ms: u64) -> Result<chrono::DateTime<Utc>, String> {
    let millis = i64::try_from(ms).map_err(|_| "timestamp out of range".to_string())?;
    chrono::DateTime::from_timestamp_millis(millis)
        .ok_or_else(|| "timestamp out of range".to_string())
}

impl Schedule {
    /// Validate, sort/deduplicate selections, and require a future occurrence.
    /// Timestamps are Unix milliseconds; occurrences must be strictly later.
    pub fn normalize_and_validate(mut self, now_ms: u64) -> Result<Self, String> {
        let (start, time, zone, end) = self.parse()?;
        timestamp(now_ms)?;
        if !matches!(
            zone.from_local_datetime(&start.and_time(time)),
            LocalResult::Single(_)
        ) {
            return Err("initial local datetime is ambiguous or nonexistent".into());
        }
        if end.is_some_and(|end| end < start) {
            return Err("end date is before start date".into());
        }
        if self.weekdays.iter().any(|day| *day > 6) {
            return Err("weekday must be between 0 and 6".into());
        }
        if self.dates.len() > MAX_DATES {
            return Err("too many selected dates".into());
        }
        for date in &self.dates {
            let selected = parse_date(date)?;
            if self.kind == ScheduleKind::Dates
                && !matches!(
                    zone.from_local_datetime(&selected.and_time(time)),
                    LocalResult::Single(_)
                )
            {
                return Err(
                    "a selected date and time is ambiguous or nonexistent in its time zone".into(),
                );
            }
            if self.kind == ScheduleKind::Dates
                && (selected < start || end.is_some_and(|end| selected > end))
            {
                return Err("selected dates must fall within the inclusive date range".into());
            }
        }
        self.weekdays.sort_unstable();
        self.weekdays.dedup();
        self.dates.sort_unstable();
        self.dates.dedup();
        if self.kind == ScheduleKind::Weekdays && self.weekdays.is_empty() {
            return Err("select at least one weekday".into());
        }
        if self.kind == ScheduleKind::Dates && self.dates.is_empty() {
            return Err("select at least one date".into());
        }
        if self.next_after(now_ms)?.is_none() {
            return Err("schedule has no future occurrence".into());
        }
        Ok(self)
    }

    fn parse(&self) -> Result<(NaiveDate, NaiveTime, Tz, Option<NaiveDate>), String> {
        let start = parse_date(&self.date)?;
        let time = parse_time(&self.time)?;
        let zone =
            Tz::from_str(&self.time_zone).map_err(|_| "invalid IANA time zone".to_string())?;
        let end = self.end_date.as_deref().map(parse_date).transpose()?;
        Ok((start, time, zone, end))
    }

    /// Find the first occurrence strictly after a Unix timestamp in milliseconds.
    /// Returns `None` when the schedule is exhausted. Call validation before storing.
    pub fn next_after(&self, after_ms: u64) -> Result<Option<u64>, String> {
        let (start, time, zone, end) = self.parse()?;
        let after = timestamp(after_ms)?;
        if end.is_some_and(|end| end < start) {
            return Err("end date is before start date".into());
        }
        if self.weekdays.iter().any(|day| *day > 6)
            || (self.kind == ScheduleKind::Weekdays && self.weekdays.is_empty())
        {
            return Err("invalid weekdays".into());
        }
        if self.dates.len() > MAX_DATES
            || (self.kind == ScheduleKind::Dates && self.dates.is_empty())
        {
            return Err("invalid selected dates".into());
        }
        // Validate all entries even if a previous entry would already match.
        let selected = self
            .dates
            .iter()
            .map(|date| parse_date(date))
            .collect::<Result<Vec<_>, _>>()?;
        if !matches!(
            zone.from_local_datetime(&start.and_time(time)),
            LocalResult::Single(_)
        ) {
            return Err("initial local datetime is ambiguous or nonexistent".into());
        }
        let resolve = |date: NaiveDate| -> Option<u64> {
            if date < start
                || (self.kind != ScheduleKind::Once && end.is_some_and(|end| date > end))
            {
                return None;
            }
            let LocalResult::Single(instant) = zone.from_local_datetime(&date.and_time(time))
            else {
                return None;
            };
            let ms = u64::try_from(instant.timestamp_millis()).ok()?;
            (ms > after_ms).then_some(ms)
        };
        match self.kind {
            ScheduleKind::Once => Ok(resolve(start)),
            ScheduleKind::Dates => Ok(selected.into_iter().filter_map(resolve).min()),
            ScheduleKind::Daily | ScheduleKind::Weekdays => {
                let mut date = start.max(after.with_timezone(&zone).date_naive());
                for _ in 0..MAX_SCAN_DAYS {
                    if date.year() > 9999 || end.is_some_and(|end| date > end) {
                        return Ok(None);
                    }
                    if (self.kind == ScheduleKind::Daily
                        || self
                            .weekdays
                            .contains(&date.weekday().num_days_from_sunday()))
                        && let Some(ms) = resolve(date)
                    {
                        return Ok(Some(ms));
                    }
                    let Some(next) = date.succ_opt() else {
                        return Ok(None);
                    };
                    date = next;
                }
                Err("occurrence search limit exceeded".into())
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ms(s: &str) -> u64 {
        chrono::DateTime::parse_from_rfc3339(s)
            .unwrap()
            .timestamp_millis() as u64
    }
    fn schedule(kind: ScheduleKind, date: &str, time: &str, zone: &str) -> Schedule {
        Schedule {
            kind,
            date: date.into(),
            time: time.into(),
            weekdays: vec![],
            dates: vec![],
            end_date: None,
            time_zone: zone.into(),
        }
    }
    #[test]
    fn once_strict_boundary_and_past() {
        let s = schedule(ScheduleKind::Once, "2025-01-01", "09:00", "Asia/Tokyo");
        let when = ms("2025-01-01T00:00:00Z");
        assert_eq!(s.next_after(when - 1).unwrap(), Some(when));
        assert_eq!(s.next_after(when).unwrap(), None);
        assert!(s.clone().normalize_and_validate(when).is_err());
        assert!(s.normalize_and_validate(when - 1).is_ok());
    }
    #[test]
    fn daily_dst_gaps_folds_and_inclusive_end() {
        let mut s = schedule(
            ScheduleKind::Daily,
            "2025-03-08",
            "02:30",
            "America/New_York",
        );
        s.end_date = Some("2025-03-10".into());
        assert_eq!(
            s.next_after(ms("2025-03-08T07:30:00Z")).unwrap(),
            Some(ms("2025-03-10T06:30:00Z"))
        );
        assert_eq!(s.next_after(ms("2025-03-10T06:30:00Z")).unwrap(), None);
        let s = schedule(
            ScheduleKind::Daily,
            "2025-11-01",
            "01:30",
            "America/New_York",
        );
        assert_eq!(
            s.next_after(ms("2025-11-01T05:30:00Z")).unwrap(),
            Some(ms("2025-11-03T06:30:00Z"))
        );
        for date in ["2025-03-09", "2025-11-02"] {
            let time = if date.ends_with("09") {
                "02:30"
            } else {
                "01:30"
            };
            assert!(
                schedule(ScheduleKind::Once, date, time, "America/New_York")
                    .normalize_and_validate(0)
                    .is_err()
            );
        }
    }
    #[test]
    fn weekdays_and_dates_are_normalized_and_bounded() {
        let mut s = schedule(ScheduleKind::Weekdays, "2025-01-01", "09:00", "UTC");
        s.weekdays = vec![1, 0, 1];
        let s = s
            .normalize_and_validate(ms("2025-01-01T00:00:00Z"))
            .unwrap();
        assert_eq!(s.weekdays, vec![0, 1]);
        assert_eq!(
            s.next_after(ms("2025-01-01T00:00:00Z")).unwrap(),
            Some(ms("2025-01-05T09:00:00Z"))
        );
        let mut s = schedule(ScheduleKind::Dates, "2025-01-01", "09:00", "UTC");
        s.dates = vec![
            "2025-01-04".into(),
            "2024-12-31".into(),
            "2025-01-02".into(),
            "2025-01-02".into(),
        ];
        s.end_date = Some("2025-01-02".into());
        assert!(
            s.clone()
                .normalize_and_validate(ms("2025-01-01T00:00:00Z"))
                .is_err()
        );
        s.dates = vec!["2025-01-02".into(), "2025-01-02".into()];
        let s = s
            .normalize_and_validate(ms("2025-01-01T00:00:00Z"))
            .unwrap();
        assert_eq!(s.dates.len(), 1);
        assert_eq!(s.next_after(0).unwrap(), Some(ms("2025-01-02T09:00:00Z")));
        assert_eq!(s.next_after(ms("2025-01-02T09:00:00Z")).unwrap(), None);
    }
    #[test]
    fn selected_future_gap_and_fold_are_skipped() {
        let mut s = schedule(
            ScheduleKind::Dates,
            "2025-03-01",
            "02:30",
            "America/New_York",
        );
        s.dates = vec!["2025-03-09".into(), "2025-03-10".into()];
        assert_eq!(s.next_after(0).unwrap(), Some(ms("2025-03-10T06:30:00Z")));
        assert!(s.clone().normalize_and_validate(0).is_err());
        s.date = "2025-10-01".into();
        s.time = "01:30".into();
        s.dates = vec!["2025-11-02".into(), "2025-11-03".into()];
        assert_eq!(s.next_after(0).unwrap(), Some(ms("2025-11-03T06:30:00Z")));
        assert!(s.normalize_and_validate(0).is_err());
    }
    #[test]
    fn old_recurrences_leap_days_and_zone_offsets() {
        let s = schedule(ScheduleKind::Daily, "2000-01-01", "09:00", "Asia/Kathmandu");
        assert_eq!(
            s.next_after(ms("2024-02-28T03:15:00Z")).unwrap(),
            Some(ms("2024-02-29T03:15:00Z"))
        );
        let s = schedule(
            ScheduleKind::Once,
            "2025-01-01",
            "09:00",
            "America/Los_Angeles",
        );
        assert_eq!(s.next_after(0).unwrap(), Some(ms("2025-01-01T17:00:00Z")));
        let mut s = schedule(ScheduleKind::Weekdays, "2025-01-01", "09:00", "UTC");
        assert!(s.next_after(0).is_err());
        s.kind = ScheduleKind::Dates;
        assert!(s.next_after(0).is_err());
        s.dates = vec!["2025-01-01".into(); MAX_DATES + 1];
        assert!(s.next_after(0).is_err());
    }
    #[test]
    fn device_timezone_changes_do_not_move_anchored_schedules() {
        if std::env::var_os("SELA_TZ_TEST_CHILD").is_some() {
            let once = schedule(
                ScheduleKind::Once,
                "2025-01-01",
                "09:00",
                "America/New_York",
            );
            let daily = schedule(
                ScheduleKind::Daily,
                "2025-01-01",
                "09:00",
                "America/New_York",
            );
            assert_eq!(
                once.next_after(0).unwrap(),
                Some(ms("2025-01-01T14:00:00Z"))
            );
            assert_eq!(
                daily.next_after(ms("2025-03-08T14:00:00Z")).unwrap(),
                Some(ms("2025-03-09T13:00:00Z"))
            );
            return;
        }
        let binary = std::env::current_exe().unwrap();
        for zone in ["UTC", "Asia/Tokyo", "America/Los_Angeles"] {
            let status = std::process::Command::new(&binary)
                .args([
                    "--exact",
                    "scheduling::tests::device_timezone_changes_do_not_move_anchored_schedules",
                ])
                .env("SELA_TZ_TEST_CHILD", "1")
                .env("TZ", zone)
                .status()
                .unwrap();
            assert!(status.success(), "test failed in device time zone {zone}");
        }
    }

    #[test]
    fn rejects_invalid_inputs_and_serializes_camel_case() {
        let base = schedule(ScheduleKind::Daily, "2025-01-01", "09:00", "UTC");
        let mut bad = base.clone();
        bad.date = "2025-02-30".into();
        assert!(bad.next_after(0).is_err());
        let mut bad = base.clone();
        bad.time = "9:00".into();
        assert!(bad.next_after(0).is_err());
        let mut bad = base.clone();
        bad.time_zone = "local".into();
        assert!(bad.next_after(0).is_err());
        let mut bad = base.clone();
        bad.end_date = Some("2024-12-31".into());
        assert!(bad.next_after(0).is_err());
        let mut bad = base.clone();
        bad.weekdays = vec![7];
        assert!(bad.next_after(0).is_err());
        let mut bad = base.clone();
        bad.dates = vec!["bad".into()];
        assert!(bad.next_after(0).is_err());
        assert!(base.next_after(u64::MAX).is_err());
        let value = serde_json::to_value(&base).unwrap();
        assert_eq!(value["kind"], "daily");
        assert_eq!(value["timeZone"], "UTC");
        assert!(value.get("endDate").is_some());
        assert_eq!(serde_json::from_value::<Schedule>(value).unwrap(), base);
    }
}
