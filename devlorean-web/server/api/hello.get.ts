const backend_baseurl = useRuntimeConfig().backend_baseurl;
export default defineEventHandler(async (event) => {
    const response = await $fetch(`${backend_baseurl}/actuator/health`, {
        method: 'GET',
    });
    return JSON.stringify(response);
});