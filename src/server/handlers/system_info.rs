use axum::Json;
use serde::Serialize;
use sysinfo::{Components, Disks, Networks, System};

// ── Response types ──

#[derive(Serialize)]
pub struct SystemInfoResponse {
    cpu: CpuInfo,
    memory: MemoryInfo,
    disk: DiskInfo,
    network: NetworkInfo,
    battery: BatteryInfo,
    uptime: u64,
}

#[derive(Serialize)]
pub struct CpuInfo {
    usage_percent: f32,
    core_count: usize,
    brand: String,
}

#[derive(Serialize)]
pub struct MemoryInfo {
    total_bytes: u64,
    available_bytes: u64,
    used_bytes: u64,
    used_percent: f32,
}

#[derive(Serialize)]
pub struct DiskInfo {
    disks: Vec<DiskDetail>,
}

#[derive(Serialize)]
pub struct DiskDetail {
    name: String,
    total_space: u64,
    available_space: u64,
    usage_percent: f32,
}

#[derive(Serialize)]
pub struct NetworkInfo {
    interfaces: Vec<NetworkInterface>,
}

#[derive(Serialize)]
pub struct NetworkInterface {
    name: String,
    bytes_sent: u64,
    bytes_received: u64,
}

#[derive(Serialize)]
pub struct BatteryInfo {
    available: bool,
    total_capacity: Option<u64>,
    current_capacity: Option<u64>,
    percentage: Option<f32>,
    charging: Option<bool>,
}

// ── Handlers ──

/// GET /api/system/info - 完整系统信息
pub async fn api_system_info() -> Json<SystemInfoResponse> {
    let mut sys = System::new_all();

    // CPU 信息
    sys.refresh_all();
    let cpu_info = sys.global_cpu_info();
    let cpu_usage = cpu_info.cpu_usage();
    let core_count = sys.cpus().len();
    let brand = sys.cpus().first().map(|c| c.brand().to_string()).unwrap_or_default();

    // 内存信息
    sys.refresh_memory();
    let total_memory = sys.total_memory();
    let available_memory = sys.available_memory();
    let used_memory = total_memory - available_memory;
    let memory_percent = if total_memory > 0 {
        (used_memory as f32 / total_memory as f32) * 100.0
    } else {
        0.0
    };

    // 磁盘信息
    let disks = Disks::new_with_refreshed_list();
    let disk_details: Vec<DiskDetail> = disks.iter().map(|disk| {
        let total = disk.total_space();
        let available = disk.available_space();
        let used = total - available;
        let usage_percent = if total > 0 {
            (used as f32 / total as f32) * 100.0
        } else {
            0.0
        };
        DiskDetail {
            name: disk.name().to_string_lossy().to_string(),
            total_space: total,
            available_space: available,
            usage_percent,
        }
    }).collect();

    // 网络信息
    let networks = Networks::new_with_refreshed_list();
    let network_interfaces: Vec<NetworkInterface> = networks.iter().map(|(name, data)| {
        NetworkInterface {
            name: name.clone(),
            bytes_sent: data.total_transmitted(),
            bytes_received: data.total_received(),
        }
    }).collect();

    // 电池信息（笔记本电脑）
    let _components = Components::new_with_refreshed_list();
    let battery = BatteryInfo {
        available: false,
        total_capacity: None,
        current_capacity: None,
        percentage: None,
        charging: None,
    };

    // 系统运行时间（秒）
    let uptime = System::uptime();

    Json(SystemInfoResponse {
        cpu: CpuInfo {
            usage_percent: cpu_usage,
            core_count,
            brand,
        },
        memory: MemoryInfo {
            total_bytes: total_memory,
            available_bytes: available_memory,
            used_bytes: used_memory,
            used_percent: memory_percent,
        },
        disk: DiskInfo { disks: disk_details },
        network: NetworkInfo { interfaces: network_interfaces },
        battery,
        uptime,
    })
}

/// GET /api/system/cpu - CPU 使用率
pub async fn api_system_cpu() -> Json<serde_json::Value> {
    let mut sys = System::new_all();
    sys.refresh_all();

    let cpu_info = sys.global_cpu_info();
    let usage = cpu_info.cpu_usage();
    let core_count = sys.cpus().len();
    let brand = sys.cpus().first().map(|c| c.brand().to_string()).unwrap_or_default();

    Json(serde_json::json!({
        "usage_percent": usage,
        "core_count": core_count,
        "brand": brand,
    }))
}

/// GET /api/system/memory - 内存使用率
pub async fn api_system_memory() -> Json<serde_json::Value> {
    let mut sys = System::new_all();
    sys.refresh_memory();

    let total = sys.total_memory();
    let available = sys.available_memory();
    let used = total - available;
    let usage_percent = if total > 0 {
        (used as f32 / total as f32) * 100.0
    } else {
        0.0
    };

    Json(serde_json::json!({
        "total_bytes": total,
        "available_bytes": available,
        "used_bytes": used,
        "usage_percent": usage_percent,
    }))
}

/// GET /api/system/disk - 磁盘空间
pub async fn api_system_disk() -> Json<serde_json::Value> {
    let disks = Disks::new_with_refreshed_list();

    let disk_details: Vec<serde_json::Value> = disks.iter().map(|disk| {
        let total = disk.total_space();
        let available = disk.available_space();
        let used = total - available;
        let usage_percent = if total > 0 {
            (used as f32 / total as f32) * 100.0
        } else {
            0.0
        };

        serde_json::json!({
            "name": disk.name().to_string_lossy(),
            "total_space": total,
            "available_space": available,
            "usage_percent": usage_percent,
        })
    }).collect();

    Json(serde_json::json!({
        "disks": disk_details,
    }))
}

/// GET /api/system/network - 网络速度
pub async fn api_system_network() -> Json<serde_json::Value> {
    let networks = Networks::new_with_refreshed_list();

    let interfaces: Vec<serde_json::Value> = networks.iter().map(|(name, data)| {
        serde_json::json!({
            "name": name,
            "bytes_sent": data.total_transmitted(),
            "bytes_received": data.total_received(),
        })
    }).collect();

    Json(serde_json::json!({
        "interfaces": interfaces,
    }))
}

/// GET /api/system/battery - 电池状态（笔记本）
pub async fn api_system_battery() -> Json<serde_json::Value> {
    // 注意：sysinfo 对电池的支持有限
    // 在 Windows 上，可以通过 Windows API 获取更详细的电池信息
    // 这里返回基本结构，后续可以扩展
    Json(serde_json::json!({
        "available": false,
        "message": "电池信息采集需要系统特定 API 支持，当前版本暂未实现",
    }))
}
