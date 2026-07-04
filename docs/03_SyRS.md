# 03. SyRS — システム要求仕様
    **参照:** ISO/IEC/IEEE 29148、品質特性はISO/IEC 25010を参照。

    ## 1. 機能要求
    | ID | 要求 | 受入条件 |
|---|---|---|
| FR-AST-001 | JSON/YAMLのPersona Contractをスキーマ検証できる。 | 必須フィールド欠落、未知の型、循環参照を422で返す。 |
| FR-AST-002 | 有効なContractから、モデル非依存のCompiled Bundleを生成できる。 | 同一入力・同一compiler versionでは内容ハッシュが一致する。 |
| FR-AST-003 | Persona Versionの作成、公開、廃止、比較を行える。 | 公開済みVersionは不変であり、差分APIが変更項目を返す。 |
| FR-AST-004 | PluginとしてContext InjectorとRendererを登録できる。 | 未登録Plugin参照時はfail-closedでコンパイルを中止する。 |
| FR-AST-005 | PolicyReferenceを外部ポリシー評価器へ引き渡すための宣言をBundleに残す。 | PolicyReferenceがない場合でも、暗黙の安全解除は行わない。 |
| FR-AST-006 | コンパイル結果の構成要素、入力Version、ハッシュ、生成時刻を監査可能にする。 | Bundle取得時に出所メタデータが必ず含まれる。 |

    ## 2. 非機能要求
    | ID | 要求 | 受入条件 |
|---|---|---|
| NFR-001 | Tenant分離 | 全読取・更新・削除クエリにtenant_idが必須。越境試験は403または404。 |
| NFR-002 | 認証・認可 | 全変更APIでactorとscopeを検証。匿名変更を許可しない。 |
| NFR-003 | 可用性と縮退 | 外部依存のtimeoutは設定可能。安全上重要な依存失敗ではfail-closed。 |
| NFR-004 | 観測性 | 全HTTP要求・外部呼出し・状態遷移にcorrelation IDを付与。 |
| NFR-005 | 性能 | 標準的な同期APIは依存成功時p95 300ms以下を目標。重い処理は非同期ジョブ化。 |
| NFR-006 | 保守性 | domain / adapter / transportを分離し、依存方向をlintまたはarchitecture testで検証。 |
| NFR-007 | 移植性 | LinuxコンテナとPostgreSQLで稼働。クラウド固有SDKをcoreへ導入しない。 |
| NFR-008 | データ保護 | Secretをログ・例外・fixtureに出力しない。Sensitiveデータの保持期間を設定可能にする。 |

    ## 3. データ完全性要求
    - すべての変更可能リソースは`id`、`tenantId`、`createdAt`、`createdBy`、`version`を持つ。
    - 追記専用の監査イベントは物理更新を禁止し、訂正は後続イベントで表現する。
    - 楽観ロックまたはVersion条件を使い、lost updateを防止する。
    - request id / idempotency keyを受け付ける変更APIは、再送による副作用の重複を防止する。

    ## 4. セキュリティ要求
    - 認可前にデータ存在を詳細に漏らさない。
    - 監査ログは本文よりもID、ハッシュ、理由コードを優先する。
    - SecretはSecretReferenceで参照し、APIのGET／export対象から除外する。
    - 開発用seedデータは実在の個人情報を含めない。

    ## 5. 互換性要求
    - RESTは`/v1`で開始する。
    - 破壊的変更は新API versionまたは明示されたdeprecation期間を設ける。
    - Plugin SPIはcore APIと別のSemVer範囲で管理し、互換性テストを公開する。
