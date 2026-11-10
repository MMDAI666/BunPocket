use tauri_plugin_sql::{Migration, MigrationKind};

/// sqlx 用迁移 SQL 的字节做 checksum；同一份文件在不同平台/换行符设置下签出时
/// `include_str!` 得到的字节可能不同（CRLF vs LF），会把已执行迁移误判成"被修改"。
/// 这里统一归一为 LF，保证 checksum 跨平台稳定（每次启动仅泄漏三份 <2KB 的静态字符串）。
fn migration_sql(sql: &'static str) -> &'static str {
    if sql.contains('\r') {
        Box::leak(sql.replace("\r\n", "\n").into_boxed_str())
    } else {
        sql
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![
        Migration {
            version: 1,
            description: "init schema and seed",
            sql: migration_sql(include_str!("../migrations/001_init.sql")),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "category icon_type",
            sql: migration_sql(include_str!("../migrations/002_category_icon_type.sql")),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "default categories v2: two-level defaults + income subsidy",
            sql: migration_sql(include_str!("../migrations/003_default_categories_v2.sql")),
            kind: MigrationKind::Up,
        },
    ];

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:bunpocket.db", migrations)
                .build(),
        )
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
