const apiBase = useRuntimeConfig().apiBase!;

export default defineEventHandler(async (event) => {
    const res = await $fetch(`${apiBase}/actuator/info`, { method: 'GET' });
    return res;
});