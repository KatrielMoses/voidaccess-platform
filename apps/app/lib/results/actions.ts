/**
 * Rename and delete are P2's (they own the investigations lifecycle). RESULTS only defines the interface
 * and a stub; at merge, P2 replaces `resultsActions` with real implementations (delete must refund nothing
 * and cascade the inv_* rows, rename needs a name column on investigations).
 */
export interface ResultsActions {
  rename(userId: string, investigationId: string, name: string): Promise<{ ok: boolean; message?: string }>;
  remove(userId: string, investigationId: string): Promise<{ ok: boolean; message?: string }>;
}

export const resultsActions: ResultsActions = {
  async rename() {
    return { ok: false, message: "Renaming isn't available yet." };
  },
  async remove() {
    return { ok: false, message: "Deleting isn't available yet." };
  },
};
