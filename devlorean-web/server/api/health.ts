export default defineEventHandler(async (event) => {
    const headers = getRequestHeaders(event);
    const host = headers.host;

    if (!(host && (host === 'localhost' || host.startsWith('localhost:')))) {
        return sendError(event, createError({ statusCode: 403 }));
    }

    return JSON.stringify({ health: "OK" });
});