export type TransactionDirection = "deposit" | "withdraw";
export type TransactionChannel = "account" | "c2c";
export type TransactionStatus = "pending" | "success" | "failed";
export type TransactionKind =
  | "deposit_account"
  | "withdraw_account"
  | "deposit_c2c"
  | "withdraw_c2c";

export type Customer = {
  id: string;
  name: string;
  account: string;
  initials: string;
  color: string;
  phone: string;
  email: string;
  bankCode: string;
  bankAccountNo: string;
  balance: number;
  withdrawableBalance: number;
  createdAt: string;
};

export type CustomerWithStats = Customer & {
  depositTotal: number;
  withdrawTotal: number;
  c2cDepositTotal: number;
  c2cWithdrawTotal: number;
  lastActivity: string | null;
};

export type Transaction = {
  id: string;
  customer: Customer;
  counterparty: Pick<Customer, "id" | "name" | "account"> | null;
  type: TransactionDirection;
  channel: TransactionChannel;
  amount: number;
  date: string;
  time: string;
  createdAt: string;
  note: string;
  status: TransactionStatus;
  transferGroupId: string | null;
};

export type FinanceSummary = {
  depositTotal: number;
  withdrawTotal: number;
  balanceTotal: number;
  withdrawableTotal: number;
  customerCount: number;
  transactionCount: number;
};

export type CustomersResponse = {
  customers: CustomerWithStats[];
  allCustomers: Customer[];
  summary: FinanceSummary;
};

export type TransactionsResponse = {
  transactions: Transaction[];
  customers: Customer[];
  summary: FinanceSummary;
};

export type CreateTransactionInput = {
  customerId: string;
  kind: TransactionKind;
  amount: number;
  counterpartyCustomerId?: string;
  note?: string;
};
