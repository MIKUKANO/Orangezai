<div align="center">

<img src="./resources/http/File/logo.png" alt="Orangezai Logo" width="160">

# Orangezai

🍊崽 Bot，支持多账号，支持协议端：OneBotv11、ComWeChat、GSUIDCore、ICQQ、QQBot、QQ频道、微信、KOOK、Telegram、Discord、OPQBot、Lagrange

仓库地址：[zhiyu1998/Orangezai](https://github.com/zhiyu1998/Orangezai)

交流群：`575663150`

</div>

项目仅供学习交流使用，严禁用于任何商业用途和非法行为。

## 安装

环境准备：

- Node.js >= 21
- Bun
- Redis
- Git
- Chrome/Chromium（可选）

```sh
git clone --depth 1 https://github.com/zhiyu1998/Orangezai
cd Orangezai
bun install
```

## 运行

前台运行：

```sh
node .
```

停止：

```sh
node . stop
```

使用 pm2 后台运行：

```sh
bun run start
bun run stop
bun run log
```

开机自启：

```sh
bun run start
pm2 save
pm2 startup
```

## 使用

推荐安装插件：

```txt
#安装genshin
#安装miao-plugin
```

设置主人：发送 `#设置主人`，日志获取验证码并发送。

## 协议端

### OneBotv11

go-cqhttp 必改项：

```yaml
uin: 账号
password: '密码'
post-format: array
universal: ws://localhost:2536/OneBotv11
```

LLOneBot / Shamrock 反向地址：

```txt
ws://localhost:2536/OneBotv11
```

Lagrange `appsettings.json`：

```json
{
  "Type": "ReverseWebSocket",
  "Host": "localhost",
  "Port": 2536,
  "Suffix": "/OneBotv11",
  "ReconnectInterval": 5000,
  "HeartBeatInterval": 5000,
  "AccessToken": ""
}
```

### ComWeChat

`.env` 必改项：

```python
websocekt_type = "Backward"
websocket_url = ["ws://localhost:2536/ComWeChat"]
```

### GSUIDCore

连接地址：

```txt
ws://localhost:2536/GSUIDCore
```

### OPQBot

启动参数：

```txt
-wsserver ws://localhost:2536/OPQBot
```

## 致谢

- [Yunzai-Bot](../../../../Le-niao/Yunzai-Bot)
- [Miao-Yunzai](../../../../yoimiya-kokomi/Miao-Yunzai)
