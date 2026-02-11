export interface Transaction {
  _id: string;
  amount: number;
  currency: string;
  direction: "DBIT" | "CRDT";
  date: Date;
  counterpartyName: string;
  counterpartyAccount: string | null;
  description: string;
  status: string;
  source: string;
  entryReference: string | null;
  merchantCategoryCode: string | null;
}
