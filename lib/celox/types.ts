import type { CeloxBankCode } from "./banks";

export type DepositTransactionStatus =
  | "SUCCESS"
  | "PENDING_APPROVE"
  | "PENDING_TRANSFER"
  | "EXPIRED";

export type CreateDepositRequest = {
  amount: number;
  sourceBankCode: CeloxBankCode;
  sourceAccountName: string;
  sourceAccountNo: string;
  referenceId?: string;
};

export type CreateDepositResponse = {
  transactionId: string;
  orderId: string;
  referenceId: string | null;
  transactionStatus: "PENDING_TRANSFER";
  amount: number;
  receivingAccount: {
    bankCode: string;
    bankName: string;
    accountName: string;
    accountNo: string;
  };
  expiresAt: string;
  slipUpload: {
    uploadUrl: string;
    expiresAt: string;
  };
};

export type CreateWithdrawalRequest = {
  amount: number;
  destinationBankCode: CeloxBankCode;
  destinationAccountName: string;
  destinationAccountNo: string;
  referenceId?: string;
};

// Celox requires the confirm payload to echo the create payload field for field.
export type ConfirmWithdrawalRequest = CreateWithdrawalRequest;

export type CreateWithdrawalResponse = {
  transactionId: string;
  orderId: string;
  referenceId: string | null;
  transactionStatus: "PENDING";
  amount: number;
  destinationAccount: {
    bankCode: string;
    bankName: string;
    accountName: string;
    accountNo: string;
  };
};

export type ConfirmWithdrawalResponse = {
  transactionId: string;
  orderId: string;
  transactionStatus: "SUCCESS";
  amount: number;
  occurredAt: string | null;
  callback: {
    callbackStatus: "SUCCESS" | "FAILED" | "PENDING";
    httpStatus: number | null;
  };
};

export type C2CMatchTtlSeconds = 300 | 600 | 900 | 1200;

export type C2CTransactionStatus =
  | "PENDING"
  | "PENDING_TRANSFER"
  | "PENDING_MANUAL_C2C"
  | "PENDING_APPROVE"
  | "PENDING_REFUND_C2C"
  | "PENDING_REVIEW"
  | "PENDING_TOPUP_C2C"
  | "SUCCESS"
  | "CANCELLED"
  | "EXPIRED"
  | (string & {});

export type C2CTransferTo = {
  bankCode: string | null;
  bankName: string | null;
  accountName: string | null;
  accountNo: string | null;
};

export type CreateC2CDepositRequest = {
  amount: number;
  sourceBankCode: CeloxBankCode;
  sourceAccountName: string;
  sourceAccountNo: string;
  matchTtlSeconds?: C2CMatchTtlSeconds;
  referenceId?: string;
};

export type CreateC2CDepositResponse = {
  transactionId: string;
  orderId: string;
  referenceId: string | null;
  transactionStatus: "PENDING" | "PENDING_TRANSFER";
  amount: number;
  transferTo: C2CTransferTo | null;
  matchDeadline: string | null;
};

export type C2CSlipVerification = {
  outcome: string;
  transRef?: string;
  [key: string]: unknown;
};

export type C2CDepositSlipResponse = {
  transactionId: string;
  orderId: string;
  transactionStatus: "SUCCESS" | "PENDING_APPROVE" | "PENDING_TRANSFER" | "EXPIRED";
  slipVerification: C2CSlipVerification;
  counterparty: {
    transactionStatus: string;
  } | null;
};

export type CancelC2CTransactionResponse = {
  transactionId: string;
  orderId: string;
  referenceId: string | null;
  transactionStatus: C2CTransactionStatus;
  cancelledAt: string | null;
};

export type C2CTransactionPart = {
  orderId: string;
  amount: number;
  feeAmount: number;
  transactionStatus: C2CTransactionStatus;
  matchDeadline: string | null;
  matchedAt: string | null;
  cancelReason: string | null;
};

export type C2CTransactionResponse = {
  transactionId: string;
  orderId: string;
  referenceId: string | null;
  direction: "deposit" | "withdraw";
  transactionStatus: C2CTransactionStatus;
  amount: number;
  feeAmount: number;
  settledAmount: number;
  heldAmount: number;
  awaitingManualReview: boolean;
  matchDeadline: string | null;
  transferTo: C2CTransferTo | null;
  parts: [C2CTransactionPart, ...C2CTransactionPart[]];
};

export type CreateC2CWithdrawalRequest = {
  amount: number;
  destinationBankCode: CeloxBankCode;
  destinationAccountName: string;
  destinationAccountNo: string;
  matchTtlSeconds?: C2CMatchTtlSeconds;
  referenceId?: string;
};

export type CreateC2CWithdrawalResponse = {
  transactionId: string;
  orderId: string;
  referenceId: string | null;
  transactionStatus: "PENDING" | "PENDING_TRANSFER" | "PENDING_MANUAL_C2C";
  amount: number;
  feeAmount: number;
  reservedAmount: number;
  awaitingManualReview: boolean;
  matchDeadline: string | null;
};

export type CeloxC2CListItem = {
  transactionId: string;
  orderId: string;
  referenceId: string | null;
  customerId: string;
  customerName: string;
  customerAccount: string;
  direction: "deposit" | "withdraw";
  transactionStatus: C2CTransactionStatus;
  amount: number;
  feeAmount: number;
  settledAmount: number;
  heldAmount: number;
  awaitingManualReview: boolean;
  matchDeadline: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CeloxC2CListResponse = {
  transactions: CeloxC2CListItem[];
};

export type SlipVerification =
  | {
      outcome: "match";
      transRef?: string;
      [key: string]: unknown;
    }
  | {
      outcome: "mismatch";
      mismatchedFields: string[];
      [key: string]: unknown;
    }
  | {
      outcome: "unverified";
      reason: string;
      [key: string]: unknown;
    };

export type DepositSlipResponse = {
  transactionId: string;
  orderId: string;
  transactionStatus: DepositTransactionStatus;
  amount: number;
  receivedAmount: number | null;
  feeAmount: number;
  walletBalance: number;
  slipVerification: SlipVerification;
  occurredAt: string | null;
  callback: {
    callbackStatus: "SUCCESS" | "FAILED" | "PENDING";
    httpStatus: number | null;
  };
};

export type CeloxCallbackRequest = {
  transactionId: string;
  orderId: string;
  referenceId: string | null;
  status: string;
  amount: number;
  occurredAt: string | null;
};

export type CeloxCallbackResponse = {
  received: true;
  duplicate: boolean;
};

export type CeloxC2CCallbackEventName =
  | "matched"
  | "settled"
  | "parked"
  | "expired"
  | "cancelled"
  | "failed";

export type CeloxC2CCallbackRequest = {
  transactionId: string;
  orderId: string;
  referenceId: string | null;
  status: C2CTransactionStatus;
  amount: number;
  occurredAt: string | null;
  event?: CeloxC2CCallbackEventName;
  transferTo?: C2CTransferTo;
};

// Celox ignores the acknowledgement body, but keeping it typed makes the
// webhook contract observable in local tests and ngrok inspection.
export type CeloxC2CCallbackResponse = {
  received: true;
  duplicate: boolean;
};

// Celox ignores the response body; the Route Handler still returns the typed
// acknowledgement above with HTTP 200 so local tests and operators can inspect it.
export type CeloxCallbackHttpResponse = {
  status: number;
  body?: CeloxCallbackResponse;
};

export type CeloxCallbackProcessingState =
  | "pending"
  | "applied"
  | "recorded"
  | "unmatched"
  | "failed";

export type CeloxCallbackDirection = "deposit" | "withdraw" | null;

export type CeloxCallbackEvent = CeloxCallbackRequest & {
  id: number;
  customerId: string | null;
  direction: CeloxCallbackDirection;
  processingState: CeloxCallbackProcessingState;
  localTransactionId: string | null;
  attemptCount: number;
  receivedCount: number;
  lastError: string | null;
  receivedAt: string;
  lastReceivedAt: string;
  processedAt: string | null;
};

export type CustomerCeloxCallbacksResponse = {
  customerId: string;
  callbacks: CeloxCallbackEvent[];
  withdrawalHolds: CeloxWithdrawalHold[];
};

export type CeloxWithdrawalHold = {
  key: string;
  kind: "creation" | "confirmation";
  orderId: string | null;
  referenceId: string | null;
  amount: number;
  state: "creating" | "ready" | "confirming" | "uncertain";
  updatedAt: string;
  canResolve: boolean;
};

export type CeloxValidationField =
  | "amount"
  | "sourceBankCode"
  | "sourceAccountName"
  | "sourceAccountNo"
  | "destinationBankCode"
  | "destinationAccountName"
  | "destinationAccountNo"
  | "matchTtlSeconds"
  | "referenceId"
  | "splitMode"
  | "splitPartAmount"
  | "splitPartCount"
  | "file";

export type CeloxFieldError = {
  field: CeloxValidationField;
  code: "required" | "invalid" | "invalid_bank_code" | "mismatch" | "not_supported";
};

export type CeloxErrorCode =
  | "invalid_request"
  | "configuration_error"
  | "unauthenticated"
  | "c2c_not_enabled_for_organisation"
  | "reference_id_conflict"
  | "c2c_busy"
  | "validation_failed"
  | "split_not_supported"
  | "c2c_disabled"
  | "c2c_duplicate_destination"
  | "c2c_org_limit_reached"
  | "c2c_insufficient_balance"
  | "c2c_already_matched"
  | "withdrawal_payload_mismatch"
  | "invalid_transaction_state"
  | "insufficient_balance"
  | "no_active_system_bank_account"
  | "rate_limited"
  | "not_found"
  | "file_required"
  | "file_invalid"
  | "deposit_expired"
  | "deposit_not_awaiting_transfer"
  | "slip_already_submitted"
  | "slip_verification_failed"
  | "request_timeout"
  | "network_error"
  | "persistence_error"
  | "upstream_error"
  | "invalid_response";

export type CeloxErrorResponse = {
  error: string;
  code: CeloxErrorCode;
  retryable: boolean;
  fieldErrors?: CeloxFieldError[];
  retryAfterSeconds?: number;
  details?: {
    limit?: number;
    current?: number;
  };
};
