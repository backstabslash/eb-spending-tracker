export interface Transaction {
  _id: string;
  amount: number;
  currency: string;
  direction: "DBIT" | "CRDT";
  date: Date;
  counterpartyName: string;
  description: string;
  status: string;
  source: string;
}
