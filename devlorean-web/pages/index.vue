<script setup lang="ts">
const { data } = await useFetch('/api/info')
</script>
<template>
    <h1>Hello World</h1>
    <p>This is an index page.</p>
    <hr />
    <pre>{{ JSON.stringify(data, null, 2) }}</pre>
</template>