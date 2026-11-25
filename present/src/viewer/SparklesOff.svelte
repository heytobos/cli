<!-- Lucide's sparkles struck through, as its own `-off` icons are, for animations turned off:
     Lucide has none. Drawn as Lucide draws, the stroke cut where the line crosses it. -->
<script lang="ts">
  let {
    size = 24,
    strokeWidth = 2,
    ...rest
  }: { size?: number; strokeWidth?: number; 'aria-hidden'?: boolean | 'true' } = $props();
  const uid = $props.id();
  const cut = `sparkles-off-${uid}`;
</script>

<svg
  {...rest}
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width={strokeWidth}
  stroke-linecap="round"
  stroke-linejoin="round"
  class="lucide-icon lucide"
>
  <mask id={cut} maskUnits="userSpaceOnUse">
    <rect width="24" height="24" fill="white" stroke="none" />
    <path d="m2 2 20 20" stroke="black" stroke-width="6" />
  </mask>
  <g mask="url(#{cut})">
    <path
      d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"
    />
    <path d="M20 2v4" />
    <path d="M22 4h-4" />
    <circle cx="4" cy="20" r="2" />
  </g>
  <path d="m2 2 20 20" />
</svg>
