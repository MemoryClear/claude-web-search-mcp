'use strict'

// Node 16 没有原生 Fetch API（全局 Request/Response 为 undefined）
// @hono/node-server 依赖 globalThis.Request，所以需要 polyfill
// undici 已作为依赖安装，调用 install() 即可注入全局对象
require('undici').install()
