/**
 * Constants for ACP client and harness operations.
 *
 * @remarks
 * Contains all constant values used across the implementation:
 * - ACP protocol method names and version
 * - JSON-RPC error codes
 * - Harness defaults (timeouts, preview limits)
 *
 * @packageDocumentation
 */

// ============================================================================
// ACP Protocol Methods
// ============================================================================

/** ACP method names */
export const ACP_METHODS = {
  // Lifecycle
  INITIALIZE: 'initialize',
  SHUTDOWN: 'shutdown',

  // Sessions
  CREATE_SESSION: 'session/new',
  LOAD_SESSION: 'session/load',
  PROMPT: 'session/prompt',
  CANCEL: 'session/cancel',
  UPDATE: 'session/update',
  REQUEST_PERMISSION: 'session/request_permission',
  SET_MODEL: 'session/set_model',

  // Protocol-level
  CANCEL_REQUEST: '$/cancel_request',
} as const

// ============================================================================
// ACP Protocol Version
// ============================================================================

/** Current protocol version - SDK uses number type */
export const ACP_PROTOCOL_VERSION = 1 as const

// ============================================================================
// JSON-RPC Error Codes
// ============================================================================

/** Standard JSON-RPC error codes */
export const JSON_RPC_ERRORS = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  REQUEST_CANCELLED: -32800,
} as const

// ============================================================================
// ACP Client Defaults
// ============================================================================

/** Default ACP Client Name */
export const DEFAULT_ACP_CLIENT_NAME = 'plaited-acp-client'

/** Default timeout for ACP operations in milliseconds */
export const DEFAULT_ACP_TIMEOUT = 30000

/** Default polling interval for streaming updates in milliseconds */
export const DEFAULT_POLLING_INTERVAL = 50

// ============================================================================
// Harness Preview Configuration
// ============================================================================

/** Number of lines to show at the head of content previews */
export const HEAD_LINES = 8

/** Number of lines to show at the tail of content previews */
export const TAIL_LINES = 4

/** Maximum content length before applying head/tail preview */
export const MAX_CONTENT_LENGTH = 500

// ============================================================================
// Harness Defaults
// ============================================================================

/** Default timeout for prompt evaluation in milliseconds */
export const DEFAULT_HARNESS_TIMEOUT = 60000

/** Default number of trials for pass@k analysis */
export const DEFAULT_TRIAL_COUNT = 5

/** Default sample size for calibration */
export const DEFAULT_CALIBRATION_SAMPLE_SIZE = 10
