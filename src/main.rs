use agentsense::quota::QuotaOrchestrator;
use agentsense::AppConfig;
use clap::{Parser, Subcommand};
use comfy_table::{presets::UTF8_FULL, Attribute, Cell, ContentArrangement, Table};
use std::time::Duration;

#[derive(Parser)]
#[command(
    name = "agentsense",
    version,
    about = "AgentSense — ExoMind 感知基础设施"
)]
struct Cli {
    #[command(subcommand)]
    command: Commands,

    #[arg(long, default_value = "config.toml")]
    config: String,
}

#[derive(Subcommand)]
enum Commands {
    /// Show current AI quota status for all configured providers
    Quota {
        /// Continuous monitoring mode
        #[arg(long)]
        watch: bool,
    },
    /// Start the web dashboard server
    Serve {
        /// Port to listen on
        #[arg(long, default_value_t = 7892)]
        port: u16,
    },
}

fn format_ts(ts: i64) -> String {
    use chrono::TimeZone;
    chrono::Local.timestamp_millis_opt(ts).single().map_or_else(
        || "—".into(),
        |t: chrono::DateTime<chrono::Local>| t.format("%Y-%m-%d %H:%M:%S").to_string(),
    )
}

fn progress_bar(pct: i64, width: usize) -> String {
    let filled = (pct as usize * width / 100).min(width);
    let empty = width - filled;
    format!("{}{}", "\u{2588}".repeat(filled), "\u{2591}".repeat(empty))
}

fn display_results(result: &agentsense::quota::FetchResult) {
    println!();

    // MiniMax
    match &result.minimax {
        Some(Ok(snap)) => {
            let ts = format_ts(snap.timestamp);
            println!("  \x1b[32m\u{25cf}\x1b[0m MiniMax \x1b[2m({ts})\x1b[0m");
            let mut table = Table::new();
            table
                .load_preset(UTF8_FULL)
                .set_content_arrangement(ContentArrangement::Dynamic)
                .set_header(vec![
                    Cell::new("Model").add_attribute(Attribute::Bold),
                    Cell::new("5h Remaining").add_attribute(Attribute::Bold),
                    Cell::new("Weekly Remaining").add_attribute(Attribute::Bold),
                ]);
            for m in &snap.models {
                let interval_remaining = m.interval_total - m.interval_usage;
                let weekly_remaining = m.weekly_total - m.weekly_usage;
                table.add_row(vec![
                    m.name.clone(),
                    format!("{interval_remaining:>8} / {}", m.interval_total),
                    format!("{weekly_remaining:>8} / {}", m.weekly_total),
                ]);
            }
            println!("{table}");
        }
        Some(Err(e)) => {
            println!("  \x1b[31m\u{25cf}\x1b[0m MiniMax \x1b[31m\u{2717}\x1b[0m {e}");
        }
        None => {
            println!("  \x1b[2m\u{25cb}\x1b[0m MiniMax \u{2014} not configured");
        }
    }

    println!();

    // DeepSeek
    match &result.deepseek {
        Some(Ok(snap)) => {
            let ts = format_ts(snap.timestamp);
            println!("  \x1b[32m\u{25cf}\x1b[0m DeepSeek \x1b[2m({ts})\x1b[0m");
            println!(
                "    Balance:  \u{00a5}{:.2} CNY / ${:.2} USD",
                snap.total_balance_cny, snap.total_balance_usd
            );
            println!(
                "    Granted:  \u{00a5}{:.2}   Topped up: \u{00a5}{:.2}",
                snap.granted_cny, snap.topped_up_cny
            );
        }
        Some(Err(e)) => {
            println!("  \x1b[31m\u{25cf}\x1b[0m DeepSeek \x1b[31m\u{2717}\x1b[0m {e}");
        }
        None => {
            println!("  \x1b[2m\u{25cb}\x1b[0m DeepSeek \u{2014} not configured");
        }
    }

    println!();

    // Z.AI
    match &result.zai {
        Some(Ok(snap)) => {
            let ts = format_ts(snap.timestamp);
            println!("  \x1b[32m\u{25cf}\x1b[0m Z.AI (GLM) \x1b[2m({ts})\x1b[0m");
            println!(
                "    Token 5h:    {:>5}% {}",
                snap.token_5h_pct,
                progress_bar(snap.token_5h_pct, 20)
            );
            println!(
                "    Token Week:  {:>5}% {}",
                snap.token_week_pct,
                progress_bar(snap.token_week_pct, 20)
            );
            println!(
                "    MCP Month:   {:>5}% {} ({}/{})",
                snap.mcp_month_pct,
                progress_bar(snap.mcp_month_pct, 20),
                snap.mcp_used,
                snap.mcp_total
            );
        }
        Some(Err(e)) => {
            println!("  \x1b[31m\u{25cf}\x1b[0m Z.AI (GLM) \x1b[31m\u{2717}\x1b[0m {e}");
        }
        None => {
            println!("  \x1b[2m\u{25cb}\x1b[0m Z.AI (GLM) \u{2014} not configured");
        }
    }

    println!();

    // Claude (Anthropic OAuth subscription)
    match &result.claude {
        Some(Ok(snap)) => {
            let ts = format_ts(snap.timestamp);
            println!("  \x1b[32m\u{25cf}\x1b[0m Claude \x1b[2m({ts})\x1b[0m");
            let r5 = if snap.five_h_reset > 0 {
                format!("  \x1b[2m\u{2192}{}\x1b[0m", format_ts(snap.five_h_reset))
            } else {
                String::new()
            };
            let r7 = if snap.seven_d_reset > 0 {
                format!("  \x1b[2m\u{2192}{}\x1b[0m", format_ts(snap.seven_d_reset))
            } else {
                String::new()
            };
            println!(
                "    5h:    {:>5}% {}{}",
                snap.five_h_pct,
                progress_bar(snap.five_h_pct, 20),
                r5
            );
            println!(
                "    7d:    {:>5}% {}{}",
                snap.seven_d_pct,
                progress_bar(snap.seven_d_pct, 20),
                r7
            );
            for l in &snap.extra {
                println!(
                    "    {:<6} {:>5}% {}",
                    l.label,
                    l.pct,
                    progress_bar(l.pct, 20)
                );
            }
        }
        Some(Err(e)) => {
            println!("  \x1b[31m\u{25cf}\x1b[0m Claude \x1b[31m\u{2717}\x1b[0m {e}");
        }
        None => {
            println!("  \x1b[2m\u{25cb}\x1b[0m Claude \u{2014} not configured");
        }
    }

    println!();
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "agentsense=info".into()),
        )
        .init();

    let cli = Cli::parse();
    let config_path = std::path::Path::new(&cli.config);

    let config = match AppConfig::load(config_path) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("Failed to load config from {}: {e}", config_path.display());
            std::process::exit(1);
        }
    };

    let orch = match QuotaOrchestrator::new(&config.quota) {
        Ok(o) => o,
        Err(e) => {
            eprintln!("Failed to initialize quota orchestrator: {e}");
            std::process::exit(1);
        }
    };

    match cli.command {
        Commands::Quota { watch } => {
            if watch {
                let interval = Duration::from_secs(config.quota.poll_interval_secs);
                println!(
                    "AI Quota Monitor \u{2014} agentsense (watch mode, {}s interval)",
                    config.quota.poll_interval_secs
                );
                loop {
                    let result = orch.fetch_all().await;
                    display_results(&result);
                    println!(
                        "  Next refresh in {}s...\r",
                        config.quota.poll_interval_secs
                    );
                    tokio::time::sleep(interval).await;
                }
            } else {
                println!("AI Quota Monitor \u{2014} agentsense");
                let result = orch.fetch_all().await;
                display_results(&result);
            }
        }
        Commands::Serve { port } => {
            if let Err(e) =
                agentsense::server::serve(&config.quota, config_path.to_path_buf(), port).await
            {
                eprintln!("Server error: {e}");
                std::process::exit(1);
            }
        }
    }
}
