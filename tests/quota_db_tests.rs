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
    let (ts, models) = db.latest_minimax_with_ts("").unwrap();
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

    db.insert_minimax(&snap, "").unwrap();

    let (ts, models) = db.latest_minimax_with_ts("").unwrap();
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
    }, "")
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
    }, "")
    .unwrap();

    let (ts, models) = db.latest_minimax_with_ts("").unwrap();
    assert_eq!(ts, 2000, "should return the latest timestamp");
    assert_eq!(models.len(), 1);
    assert_eq!(models[0].name, "new-model");
}

#[test]
fn multi_account_deepseek_latest_returns_per_label() {
    use agentsense::quota::deepseek::DeepSeekSnapshot;

    let db = make_db();
    let snap1 = DeepSeekSnapshot {
        timestamp: 1000,
        total_balance_cny: 50.0,
        total_balance_usd: 0.0,
        granted_cny: 0.0,
        topped_up_cny: 50.0,
    };
    let snap2 = DeepSeekSnapshot {
        timestamp: 1000,
        total_balance_cny: 30.0,
        total_balance_usd: 0.0,
        granted_cny: 0.0,
        topped_up_cny: 30.0,
    };
    db.insert_deepseek(&snap1, "main").unwrap();
    db.insert_deepseek(&snap2, "alt").unwrap();

    let main = db.latest_deepseek("main").unwrap().unwrap();
    assert_eq!(main.total_balance_cny, 50.0);
    let alt = db.latest_deepseek("alt").unwrap().unwrap();
    assert_eq!(alt.total_balance_cny, 30.0);

    let all = db.latest_all_deepseek().unwrap();
    assert_eq!(all.len(), 2);
}

#[test]
fn multi_account_minimax_latest_returns_per_label() {
    let db = make_db();

    let snap_main = MinimaxSnapshot {
        timestamp: 1000,
        models: vec![ModelQuota {
            name: "model-a".into(),
            interval_usage: 10,
            interval_total: 100,
            weekly_usage: 50,
            weekly_total: 500,
            interval_end: None,
            weekly_end: None,
        }],
    };
    let snap_alt = MinimaxSnapshot {
        timestamp: 1000,
        models: vec![ModelQuota {
            name: "model-b".into(),
            interval_usage: 20,
            interval_total: 200,
            weekly_usage: 80,
            weekly_total: 800,
            interval_end: None,
            weekly_end: None,
        }],
    };
    db.insert_minimax(&snap_main, "main").unwrap();
    db.insert_minimax(&snap_alt, "alt").unwrap();

    let (ts_main, models_main) = db.latest_minimax_with_ts("main").unwrap();
    assert_eq!(ts_main, 1000);
    assert_eq!(models_main.len(), 1);
    assert_eq!(models_main[0].name, "model-a");

    let (ts_alt, models_alt) = db.latest_minimax_with_ts("alt").unwrap();
    assert_eq!(ts_alt, 1000);
    assert_eq!(models_alt.len(), 1);
    assert_eq!(models_alt[0].name, "model-b");

    let all = db.latest_all_minimax().unwrap();
    assert_eq!(all.len(), 2);
}
