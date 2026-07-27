# ジャングルバルーンシューティング 2人プレイ改造版

先輩作成版の通信構成を土台にした改造版です。

## 維持した部分

- `shared/firebase.js` のFirebase設定・匿名認証・接続処理
- `shared/room-code.js` の4文字コード生成・URL作成
- `rooms/{roomId}/aim`
- `rooms/{roomId}/fireCounter`
- `rooms/{roomId}/phoneConnected`
- スマホのジャイロ送信と発射カウンター方式

## 追加した部分

- PC画面を左右に2分割
- PLAYER 1 / PLAYER 2ごとに別の接続コードとQRコード
- スマホ側にスタートボタン
- `rooms/{roomId}/ready` を追加し、2人とも押した時だけカウントダウン開始
- 左右それぞれ専用の照準・風船・スコア
- 左右で常に同じ数の風船を表示
- 終了時は2人分のスコアのみ表示（勝敗表示なし）

## フォルダ構成

- `index.html`：PC側
- `smartphone.html`：スマホ側
- `script.js`：PC側ゲーム処理
- `phone.js`：スマホ側操作
- `shared/firebase.js`：先輩版のFirebase共通処理
- `shared/room-code.js`：先輩版の接続コード処理

GitHub Pagesへフォルダ構成のままアップロードしてください。
