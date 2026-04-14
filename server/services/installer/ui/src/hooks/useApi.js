/**
 * API Hook for installer requests
 */

export function useApi(sessionId) {
  const baseUrl = '';

  const headers = {
    'Content-Type': 'application/json',
    ...(sessionId && { 'X-Session-Id': sessionId }),
  };

  const handleResponse = async (response) => {
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || data.message || 'Request failed');
    }
    return data;
  };

  return {
    get: async (path) => {
      const response = await fetch(`${baseUrl}${path}`, {
        method: 'GET',
        headers,
      });
      return handleResponse(response);
    },

    post: async (path, body) => {
      const response = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
      return handleResponse(response);
    },

    put: async (path, body) => {
      const response = await fetch(`${baseUrl}${path}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(body),
      });
      return handleResponse(response);
    },
  };
}

export default useApi;
