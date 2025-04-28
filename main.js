const { app, BrowserWindow, Menu, Tray, Notification, dialog } = require('electron');
const { menubar } = require('menubar');
const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');
const fs = require("fs")
const chokidar = require("chokidar") // 引入chokidar库

const iconPath = path.join(__dirname, "assets", "IconTemplate.png")

// 添加全局变量初始化
let lastVerificationCode = ""
let verificationHistory = []

// 获取数据库路径
function getDbPath() {
  const homedir = os.homedir()
  return path.join(homedir, "Library/Messages/chat.db")
}

let db = null
function initDatabase() {
  try {
    const dbPath = getDbPath()
    db = new Database(dbPath, {
      readonly: true,
      fileMustExist: true,
    })
    console.log("数据库连接成功")
  } catch (err) {
    console.error("数据库连接失败:", err.message)
    dialog.showErrorBox(
      "错误",
      "无法访问 Messages 数据库。请确保：\n" +
        "1. 已授予终端完全磁盘访问权限\n" +
        "2. 已授予应用完全磁盘访问权限"
    )
    app.quit()
  }
}

// 防抖函数，避免短时间内多次触发同一事件
function debounce(func, wait) {
  let timeout
  return function (...args) {
    const later = () => {
      clearTimeout(timeout)
      func(...args)
    }
    clearTimeout(timeout)
    timeout = setTimeout(later, wait)
  }
}

// 增加防抖时间到2000毫秒，避免短时间内重复触发
const debouncedCheckVerificationCode = debounce(checkVerificationCode, 2000)

// 记录上次查询的结果和时间，用于过滤重复日志
let lastQueryResult = null
let lastQueryTime = 0

function checkVerificationCode() {
  try {
    if (!db) return

    const now = Date.now()
    const query = `
      SELECT text, date/1000000000 + strftime('%s', '2001-01-01') as timestamp
      FROM message 
      WHERE date/1000000000 + strftime('%s', '2001-01-01') > strftime('%s', 'now') - 60
      ORDER BY date DESC 
      LIMIT 1
    `

    const row = db.prepare(query).get()

    // 检查是否与上次查询结果相同且时间间隔小于10秒，如果是则不输出重复日志
    const isSameResult =
      lastQueryResult &&
      row &&
      lastQueryResult.text === row.text &&
      lastQueryResult.timestamp === row.timestamp
    const isRecentQuery = now - lastQueryTime < 10000 // 10秒内

    if (!(isSameResult && isRecentQuery)) {
      console.log("查询时间:", new Date().toLocaleString())
      console.log(
        "查询结果:",
        row
          ? {
              text: row.text,
              time: new Date(row.timestamp * 1000).toLocaleString(),
            }
          : "无新消息"
      )

      // 更新上次查询记录
      lastQueryResult = row ? { ...row } : null
      lastQueryTime = now
    }

    if (!row) return

    if (row.text && row.text.includes("验证码")) {
      const codeMatch = row.text.match(/\d{4,6}/)
      if (codeMatch) {
        const code = codeMatch[0]
        if (code !== lastVerificationCode) {
          lastVerificationCode = code

          verificationHistory.unshift({
            code,
            date: new Date().toLocaleString(),
            text: row.text,
          })
          verificationHistory = verificationHistory.slice(0, 5)

          require("electron").clipboard.writeText(code)
          new Notification({ title: "验证码已复制", body: code }).show()
        }
      }
    }
  } catch (err) {
    console.error("查询失败:", err.message)
  }
}

// 检查磁盘访问权限
function checkDiskAccessPermission() {
  try {
    const testPath = path.join(os.homedir(), "Library/Messages/chat.db")
    fs.accessSync(testPath, fs.constants.R_OK)
    return true
  } catch (err) {
    return false
  }
}

// 添加一个函数用于检测是否在开发模式下运行
function isDevMode() {
  // 如果是通过npm run start启动的，process.execPath会指向electron而不是最终应用
  return (
    process.execPath.includes("electron") ||
    process.env.NODE_ENV === "development"
  )
}

// 获取macOS版本（格式如：10.15, 11.0, 12.0等）
function getMacOSVersion() {
  if (process.platform !== "darwin") return 0
  const osRelease = os.release()
  // macOS的release格式为：Darwin Kernel Version 20.6.0: Mon Aug 30 06:12:20 PDT 2021; root:xnu-7195.141.6~3/RELEASE_X86_64
  // 版本号是第二位的数字
  const match = osRelease.match(/^\d+\.(\d+)\./)
  if (match && match[1]) {
    // 从10.0起，macOS的主版本号需要加10（如10.15 = OSX 10.15, 20.x = macOS 11.x）
    return parseInt(match[1], 10) - 4
  }
  return 0
}

// 获取适合当前macOS版本的登录项设置
function getLoginItemSettings(openAtLogin = true) {
  const macOSVersion = getMacOSVersion()
  console.log(`检测到macOS版本: ${macOSVersion}`)

  let settings = {
    openAtLogin,
    name: "Mess Auto",
  }

  // macOS 13及以上版本需要使用type参数
  if (macOSVersion >= 13) {
    settings.type = "mainAppService" // 使用主应用服务类型
  } else if (macOSVersion > 0) {
    // 旧版macOS（低于13）可以使用openAsHidden
    settings.openAsHidden = true
  }

  return settings
}

app.on("ready", () => {
  // 检查磁盘权限
  if (!checkDiskAccessPermission()) {
    dialog.showErrorBox(
      "权限错误",
      "需要完全磁盘访问权限才能运行此应用。\n" +
        "请前往系统设置 -> 隐私与安全性 -> 完全磁盘访问权限，\n" +
        "并添加此应用到允许列表中。"
    )
    app.quit()
    return
  }

  // 获取当前开发模式状态
  const devMode = isDevMode()
  console.log("开发模式:", devMode ? "是" : "否")

  // 移除开发模式检查，始终尝试设置开机启动
  let hasShownLoginItemPrompt = false

  // 获取当前开机启动设置
  const currentSettings = app.getLoginItemSettings()
  console.log("当前开机启动设置:", currentSettings)

  // 只有在未设置开机启动时才尝试设置
  if (!currentSettings.openAtLogin) {
    try {
      // 获取适合当前macOS版本的登录项设置
      const loginSettings = getLoginItemSettings(true)
      console.log("使用以下配置设置开机启动:", loginSettings)
      app.setLoginItemSettings(loginSettings)

      // 检查设置是否成功
      const updatedSettings = app.getLoginItemSettings()
      console.log("设置后的开机启动状态:", updatedSettings)

      // 如果设置不成功，显示对话框引导用户手动设置
      if (!updatedSettings.openAtLogin && !hasShownLoginItemPrompt) {
        hasShownLoginItemPrompt = true
        dialog.showMessageBox({
          type: "info",
          title: "设置开机启动",
          message: "需要手动设置开机启动项",
          detail:
            '由于系统权限限制，无法自动设置开机启动。\n\n如果您希望此应用在登录时自动启动，请按以下步骤操作：\n1. 打开系统设置\n2. 点击"用户与群组"\n3. 选择"登录项"\n4. 点击+号添加"Mess Auto"到登录项列表',
          buttons: ["我知道了"],
          defaultId: 0,
        })
      }
    } catch (err) {
      console.error("设置开机启动失败:", err)
    }
  }

  // 初始化数据库
  initDatabase()

  // 设置文件监控
  const dbPath = getDbPath()
  console.log("数据库路径:", dbPath)
  const filesToWatch = [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]
  console.log("监控以下文件:", filesToWatch)

  const watcher = chokidar.watch(filesToWatch, {
    persistent: true,
    ignoreInitial: true, // 忽略初始添加事件
    awaitWriteFinish: {
      // 等待写入稳定
      stabilityThreshold: 500, // 500ms内无变化认为写入完成
      pollInterval: 100,
    },
  })

  watcher
    .on("change", (filePath) => {
      console.log(`文件变化: ${filePath}，检查验证码...`)
      debouncedCheckVerificationCode()
    })
    .on("error", (error) => console.error(`文件监控错误: ${error}`))

  // 应用退出时关闭监控
  app.on("will-quit", () => {
    console.log("停止文件监控")
    watcher.close()
  })

  const tray = new Tray(iconPath)
  // 获取当前开机启动状态，移除开发模式检查
  const getLoginStatus = () => {
    const settings = app.getLoginItemSettings()
    return settings.openAtLogin
  }

  // 创建带复选框的菜单项
  const contextMenu = Menu.buildFromTemplate([
    {
      label: "开机启动", // 移除开发模式提示
      type: "checkbox",
      checked: getLoginStatus(),
      // enabled: !devMode, // 移除开发模式禁用
      click: () => {
        // if (devMode) return; // 移除开发模式检查

        const currentStatus = getLoginStatus()
        const newStatus = !currentStatus
        console.log(`正在${newStatus ? "启用" : "禁用"}开机启动...`)

        try {
          // 使用适合当前macOS版本的登录项设置
          const loginSettings = getLoginItemSettings(newStatus)
          console.log("使用以下配置更新开机启动:", loginSettings)
          app.setLoginItemSettings(loginSettings)

          const updatedSettings = app.getLoginItemSettings()
          console.log("更新后的开机启动设置:", updatedSettings)

          // 如果设置启用但实际未启用，则显示指导对话框
          if (
            newStatus &&
            !updatedSettings.openAtLogin &&
            !hasShownLoginItemPrompt
          ) {
            hasShownLoginItemPrompt = true
            dialog.showMessageBox({
              type: "info",
              title: "设置开机启动",
              message: "需要手动设置开机启动项",
              detail:
                '由于系统权限限制，无法自动设置开机启动。\n\n如果您希望此应用在登录时自动启动，请按以下步骤操作：\n1. 打开系统设置\n2. 点击"用户与群组"\n3. 选择"登录项"\n4. 点击+号添加"Mess Auto"到登录项列表',
              buttons: ["我知道了"],
              defaultId: 0,
            })
          }
        } catch (err) {
          console.error("设置开机启动失败:", err)
          dialog.showErrorBox("错误", `设置开机启动失败: ${err.message}`)
        }
      },
    },
    { type: "separator" },
    {
      label: "退出",
      click: () => {
        app.quit()
      },
    },
  ])
  tray.setContextMenu(contextMenu)

  const mb = menubar({
    tray,
  })

  mb.on("ready", () => {
    // needed for macos to remove white screen
    // ref: https://github.com/max-mapper/menubar/issues/345
    tray.removeAllListeners()
    // 启动时执行一次检查
    checkVerificationCode()
    console.log("Menubar app is ready. 已启用基于文件监控的验证码检测")
    // your app code here
  })
})