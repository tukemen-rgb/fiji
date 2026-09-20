# fiji

Taxi Protection Platform for Fiji.

Traveler-first taxi marketplace with fare protection, verified drivers, local rule automation, live trip mapping, competing driver offers, and verified ride reviews.

## 起動方法（役割別オンボーディングUI）

ビルド不要の静的ページです。

```bash
python3 -m http.server 8000
# → http://localhost:8000 を開く（index.html を直接開いても動作します）
```

最初の画面で「利用者 / 運転手」を選び、役割別の登録を経てそれぞれのホームへ進みます。
運転手は申請後も**審査待ち**のままで、受付・料金提示はできません。

テスト:

```bash
node --test prototypes/tests/onboarding-core.test.cjs prototypes/tests/verification.test.cjs
```

実装範囲・実行結果・未接続サービスの一覧は `docs/CLAUDE_RUN_2026-09-20.md` を参照してください。
