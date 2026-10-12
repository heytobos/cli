<script lang="ts">
  let { text, id }: { text: string; id: number } = $props();
</script>

<span class="pill" data-part="pill">{text}<small data-part="id">{id}</small></span>

<style>
  .pill {
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    padding: 12px 24px;
    border-radius: 16px;
    background: #fff3cc;
    font-size: 48px;
  }
  small {
    font-size: 28px;
    color: #6b7472;
  }
</style>
