export function InternalError({ error, id }) {
  return {
    jsonrpc: "2.0",
    error: {
      code: -32603,
      message: "Internal error",
      data: {
        error: error.message
      }
    },
    id
  };
}

export function MethodNotFound({ id, method }) {
  return {
    jsonrpc: "2.0",
    error: {
      code: -32601,
      message: "Method not found",
      data: {
        method
      }
    },
    id
  };
}
