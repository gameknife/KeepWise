import type { AccountNote, LoosePayload } from "../../lib/desktopApi";
import { readArray, readString } from "../../utils/value";

type AccountNotesEditorProps = {
  accountCatalog: LoosePayload | null;
  notesByAccountId: Record<string, AccountNote>;
  visibleKind: string;
  onVisibleKindChange: (kind: string) => void;
  onNoteChange: (accountId: string, field: "holdings_text" | "risk_note" | "note_text", value: string) => void;
};

const KIND_OPTIONS = [
  { value: "investment", label: "投资账户" },
  { value: "cash", label: "现金账户" },
  { value: "real_estate", label: "不动产账户" },
  { value: "liability", label: "负债账户" },
  { value: "all", label: "全部账户" },
];

export function AccountNotesEditor({
  accountCatalog,
  notesByAccountId,
  visibleKind,
  onVisibleKindChange,
  onNoteChange,
}: AccountNotesEditorProps) {
  const accounts = readArray(accountCatalog, "rows").filter((row) => {
    if (visibleKind === "all") return true;
    return readString(row, "account_kind") === visibleKind;
  });

  return (
    <div className="analysis-export-note-editor">
      <div className="analysis-export-note-toolbar">
        <label className="field">
          <span>账户范围</span>
          <select value={visibleKind} onChange={(e) => onVisibleKindChange(e.target.value)}>
            {KIND_OPTIONS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="table-wrap analysis-export-notes-table-wrap">
        <table className="data-table analysis-export-notes-table">
          <thead>
            <tr>
              <th>账户</th>
              <th>持仓 / 代码 / 比例</th>
              <th>风险备注</th>
              <th>一般备注</th>
            </tr>
          </thead>
          <tbody>
            {accounts.length === 0 ? (
              <tr>
                <td colSpan={4}>暂无账户记录。</td>
              </tr>
            ) : (
              accounts.map((account) => {
                const accountId = readString(account, "account_id") ?? "";
                const note = notesByAccountId[accountId];
                return (
                  <tr key={accountId}>
                    <td>
                      <div className="analysis-export-account-cell">
                        <strong>{readString(account, "account_name") ?? accountId}</strong>
                        <span>{readString(account, "account_kind") ?? "-"}</span>
                      </div>
                    </td>
                    <td>
                      <textarea
                        value={note?.holdings_text ?? ""}
                        onChange={(e) => onNoteChange(accountId, "holdings_text", e.target.value)}
                        placeholder="如：60% 510300 / 30% 513050 / 10% 现金"
                      />
                    </td>
                    <td>
                      <textarea
                        value={note?.risk_note ?? ""}
                        onChange={(e) => onNoteChange(accountId, "risk_note", e.target.value)}
                        placeholder="如：高波动，长期持有"
                      />
                    </td>
                    <td>
                      <textarea
                        value={note?.note_text ?? ""}
                        onChange={(e) => onNoteChange(accountId, "note_text", e.target.value)}
                        placeholder="补充说明"
                      />
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
