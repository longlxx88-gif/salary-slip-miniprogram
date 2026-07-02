# 个人工资条拍照识别记账系统 - 微信小程序初版

这是按需求文档搭建的微信原生小程序初版，包含：

- 首页工资台账、年份筛选、编辑/删除/重拍覆盖、CSV 导出
- 拍照/相册选图、临时云文件 URL 传云函数 OCR、开发样例回退
- 薪资校对、低置信金额强制确认、金额字符纠错、应发/扣除/实发校验
- 首次识别自动生成收入/扣除/合计模板，模板管理与重置
- 本地 Storage 存储记录、统计汇总、折线/饼图/柱状图 Canvas 初版
- 隐私设置、置信度阈值、云备份开关占位
- OCR 云函数中转，腾讯云 SecretId/SecretKey 不进入前端

## 使用方式

1. 用微信开发者工具导入本目录。
2. 在 `project.config.json` 中替换正式小程序 `appid`。
3. 开通微信云开发，并上传部署 `cloudfunctions/ocr`。
4. 在云开发数据库创建集合 `ocr_results`，用于保存完整 OCR 识别结果。
5. 在云函数环境变量中设置：
   - `TENCENT_SECRET_ID`
   - `TENCENT_SECRET_KEY`
   - `TENCENT_REGION`，默认 `ap-guangzhou`
6. 建议将 `ocr` 云函数超时时间设置为 30 秒，复杂表格识别后需要写入数据库。
7. 未配置云函数或密钥时，小程序会使用样例 OCR 数据，便于先验证校对、保存、统计流程。

## 说明

初版未集成本地 OCR、WASM 推理或离线模型。前端会先压缩图片并上传到云存储临时路径，再将临时 URL 传给云函数；云函数调用腾讯云表格识别接口 `RecognizeTableAccurateOCR`。统计图表当前使用原生 Canvas 实现，后续可替换为 ECharts For 微信小程序组件。

## 云函数不可用排查

如果前端提示“云函数不可用”，按下面顺序检查：

1. 确认微信开发者工具顶部云开发环境为 `app.js` 中的 `env`：`cloud1-d0grza2b4af76d2b4`。
2. 右键 `cloudfunctions/ocr`，选择“上传并部署：云端安装依赖”。
3. 在云开发控制台确认存在名为 `ocr` 的云函数，不是 `OCR` 或其他名字。
4. 云开发数据库建议存在 `ocr_results` 集合；若缺失，识别仍可回退旧流程，但无法保存完整 OCR 调试结果。
5. 云函数环境变量必须设置 `TENCENT_SECRET_ID`、`TENCENT_SECRET_KEY`，可选 `TENCENT_REGION=ap-guangzhou`。
6. 在开发者工具控制台查看 `ocr cloud function failed` 后面的真实错误。
7. 在云开发控制台查看 `ocr` 云函数日志，正常会看到：
   - `[OCR] secretId exists: true`
   - `[OCR] secretKey exists: true`
   - `[OCR] region: ap-guangzhou`

当前云函数已经做了保护：如果未设置腾讯云密钥，会返回样例 OCR 数据；如果腾讯云 OCR 调用失败，会返回具体错误信息并在前端弹窗展示。

## OCR 接口参数

当前云函数使用腾讯云表格识别接口：

- `Action=RecognizeTableAccurateOCR`
- 优先传 `ImageUrl`
- 兜底传 `ImageBase64`
- `UseNewModel=false`

不要再添加 `EnableCoord`、`EnableWordPolygon`、`ConfigID` 或 `IsWords`，这些不是表格识别接口文档支持的入参。腾讯云返回的 `Data` 是 Excel 文件 Base64，云函数不会返回给前端，避免结果体过大；前端只接收轻量化后的单元格文本和坐标。
