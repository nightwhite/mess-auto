const { app, BrowserWindow, Menu, Tray, Notification, dialog } = require('electron');
const { menubar } = require('menubar');
const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');
const fs = require("fs")

const iconPath = path.join(__dirname, 'assets', 'IconTemplate.png');

let interval = 5000

// 添加全局变量初始化
let lastVerificationCode = '';
let verificationHistory = [];

// 获取数据库路径
function getDbPath() {
  const homedir = os.homedir();
  return path.join(homedir, 'Library/Messages/chat.db');
}

let db = null;
function initDatabase() {
  try {
    const dbPath = getDbPath();
    db = new Database(dbPath, {
      readonly: true,
      fileMustExist: true,
    });
    console.log('数据库连接成功');
  } catch (err) {
    console.error('数据库连接失败:', err.message);
    dialog.showErrorBox('错误', 
      '无法访问 Messages 数据库。请确保：\n' +
      '1. 已授予终端完全磁盘访问权限\n' +
      '2. 已授予应用完全磁盘访问权限'
    );
    app.quit();
  }
}

function checkVerificationCode() {
  try {
    if (!db) return;
    
    const query = `
      SELECT text, date/1000000000 + strftime('%s', '2001-01-01') as timestamp
      FROM message 
      WHERE date/1000000000 + strftime('%s', '2001-01-01') > strftime('%s', 'now') - 60
      ORDER BY date DESC 
      LIMIT 1
    `;
    
    const row = db.prepare(query).get();
    
    console.log('查询时间:', new Date().toLocaleString());
    console.log('查询结果:', row ? {
      text: row.text,
      time: new Date(row.timestamp * 1000).toLocaleString()
    } : '无新消息');

    if (!row) return;

    if (row.text && row.text.includes('验证码')) {
      const codeMatch = row.text.match(/\d{4,6}/);
      if (codeMatch) {
        const code = codeMatch[0];
        if (code !== lastVerificationCode) {
          lastVerificationCode = code;
          
          verificationHistory.unshift({
            code,
            date: new Date().toLocaleString(),
            text: row.text
          });
          verificationHistory = verificationHistory.slice(0, 5);
          
          require('electron').clipboard.writeText(code);
          new Notification({ title: '验证码已复制', body: code }).show();
        }
      }
    }
  } catch (err) {
    console.error('查询失败:', err.message);
  }
}

// 检查磁盘访问权限
function checkDiskAccessPermission() {
  try {
    const testPath = path.join(os.homedir(), 'Library/Messages/chat.db');
    fs.accessSync(testPath, fs.constants.R_OK);
    return true;
  } catch (err) {
    return false;
  }
}

app.on('ready', () => {
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

  // 设置开机启动
  const loginSettings = {
    openAtLogin: true,
    openAsHidden: true,
    name: "Mess Auto",
  }
  app.setLoginItemSettings(loginSettings)

  // 检查设置结果
  const currentSettings = app.getLoginItemSettings()

  // 初始化数据库
  initDatabase()

  const tray = new Tray(iconPath)
  // 获取当前开机启动状态
  const getLoginStatus = () => {
    const settings = app.getLoginItemSettings()
    return settings.openAtLogin
  }

  // 创建带复选框的菜单项
  const contextMenu = Menu.buildFromTemplate([
    {
      label: "开机启动",
      type: "checkbox",
      checked: getLoginStatus(),
      click: () => {
        const currentStatus = getLoginStatus()
        const newStatus = !currentStatus
        console.log(`正在${newStatus ? "启用" : "禁用"}开机启动...`)

        app.setLoginItemSettings({
          openAtLogin: newStatus,
          openAsHidden: true,
          name: "Mess Auto",
        })

        const updatedSettings = app.getLoginItemSettings()
        console.log("更新后的开机启动设置:", updatedSettings)
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
    setInterval(checkVerificationCode, interval)
    console.log("Menubar app is ready.")
    // your app code here
  })
});