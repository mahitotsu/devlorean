export default defineEventHandler(async (event) => {
    const apiBaseUrl = useRuntimeConfig(event).apiBaseUrl;
    return await $fetch(`${apiBaseUrl}/actuator/info`, {
        method: 'GET',
    });
});