export interface SessionAccount {
  uid: string;
  iban: string;
}

export interface Session {
  _id: string;
  sessionId: string;
  accounts: SessionAccount[];
  validUntil: string;
}
