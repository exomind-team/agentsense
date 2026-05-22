use agentsense::quota::db::QuotaDb;
use agentsense::quota::minimax::{MinimaxSnapshot, ModelQuota};

fn make_db() -> QuotaDb {
    let dir = tempfile::tempdir().expect("tempdir");
    let db_path = dir.path().join("test.db");
    // Keep tempdir alive for the test duration by leaking it
    std::mem::forget(dir);
    QuotaDb::open(&db_path).expect("open db")
}

#[test]
fn latest_minimax_with_ts_empty_db() {
    let db = make_db();
    let (ts, models) = db.latest_minimax_with_ts().unwrap();
    assert_eq!(ts, 0, "empty DB should return ts=0");
    assert!(models.is_empty(), "empty DB should return no models");
}

#[test]
fn latest_minimax_with_ts_returns_timestamp_and_models() {
    let db = make_db();

    let snap = MinimaxSnapshot {
        timestamp: 1716000000000_i64,
        models: vec![
            ModelQuota {
                name: "model-a".into(),
                interval_usage: 10,
                interval_total: 100,
                weekly_usage: 50,
                weekly_total: 500,
                interval_end: None,
                weekly_end: None,
            },
            ModelQuota {
                name: "model-b".into(),
                interval_usage: 20,
                interval_total: 200,
                weekly_usage: 80,
                weekly_total: 800,
                interval_end: None,
                weekly_end: None,
            },
        ],
    };

    db.insert_minimax(&snap).unwrap();

    let (ts, models) = db.latest_minimax_with_ts().unwrap();
    assert_eq!(
        ts, 1716000000000_i64,
        "timestamp should match inserted snapshot"
    );
    assert_eq!(models.len(), 2, "should return 2 models");

    let ma = models
        .iter()
        .find(|m| m.name == "model-a")
        .expect("model-a");
    assert_eq!(ma.interval_usage, 10);
    assert_eq!(ma.interval_total, 100);
    assert_eq!(ma.weekly_usage, 50);
    assert_eq!(ma.weekly_total, 500);

    let mb = models
        .iter()
        .find(|m| m.name == "model-b")
        .expect("model-b");
    assert_eq!(mb.interval_usage, 20);
    assert_eq!(mb.interval_total, 200);
    assert_eq!(mb.weekly_usage, 80);
    assert_eq!(mb.weekly_total, 800);
}

#[test]
fn latest_minimax_with_ts_returns_latest_of_multiple() {
    let db = make_db();

    // Insert older snapshot
    db.insert_minimax(&MinimaxSnapshot {
        timestamp: 1000,
        models: vec![ModelQuota {
            name: "old-model".into(),
            interval_usage: 1,
            interval_total: 10,
            weekly_usage: 5,
            weekly_total: 50,
            interval_end: None,
            weekly_end: None,
        }],
    })
    .unwrap();

    // Insert newer snapshot
    db.insert_minimax(&MinimaxSnapshot {
        timestamp: 2000,
        models: vec![ModelQuota {
            name: "new-model".into(),
            interval_usage: 2,
            interval_total: 20,
            weekly_usage: 10,
            weekly_total: 100,
            interval_end: None,
            weekly_end: None,
        }],
    })
    .unwrap();

    let (ts, models) = db.latest_minimax_with_ts().unwrap();
    assert_eq!(ts, 2000, "should return the latest timestamp");
    assert_eq!(models.len(), 1);
    assert_eq!(models[0].name, "new-model");
}
