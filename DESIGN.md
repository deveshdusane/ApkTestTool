---
# Design Tokens
colors:
  background:
    dark: "#050508"
    light: "#0f0f16"
    gradient: "radial-gradient(circle at top left, #0f0f16, #050508 100%)"
  surface:
    base: "rgba(255, 255, 255, 0.02)"
    hover: "rgba(255, 255, 255, 0.04)"
    active: "rgba(255, 255, 255, 0.06)"
    glass: "rgba(10, 10, 15, 0.6)"
  border:
    base: "rgba(255, 255, 255, 0.06)"
    glow: "rgba(139, 92, 246, 0.3)"
  primary:
    base: "#8b5cf6"
    light: "#a78bfa"
    dim: "rgba(139, 92, 246, 0.15)"
    gradient: "linear-gradient(135deg, #8b5cf6, #7c3aed)"
  secondary:
    base: "#06b6d4"
    light: "#22d3ee"
    gradient: "linear-gradient(135deg, #06b6d4, #0ea5e9)"
  accent:
    base: "#ec4899"
    dim: "rgba(236, 72, 153, 0.15)"
    gradient: "linear-gradient(135deg, #ec4899, #f43f5e)"
  status:
    success: "#10b981"
    warning: "#f59e0b"
    danger: "#ef4444"
  text:
    main: "#f8fafc"
    muted: "#94a3b8"
    sub: "#64748b"

typography:
  fonts:
    sans: "'Outfit', system-ui, sans-serif"
    mono: "'JetBrains Mono', monospace"
  sizes:
    base: "15px"
    h1: "2.2em"
    h3: "1.05em"
    logo: "1.4em"
    nav: "0.95em"
    label: "0.7em"
    sub: "0.75em"
  weights:
    light: 300
    regular: 400
    medium: 500
    semibold: 600
    bold: 700
    black: 800

spacing:
  sidebar_width: "280px"
  main_padding: "40px 50px"
  card_padding: "26px"
  gap_sidebar: "28px"
  gap_section: "12px"
  gap_nav: "6px"

radii:
  sm: "8px"
  md: "14px"
  lg: "24px"
  pill: "999px"

effects:
  shadows:
    soft: "0 8px 32px rgba(0, 0, 0, 0.3)"
    glow: "0 0 30px rgba(139, 92, 246, 0.2)"
    inner: "inset 0 2px 10px rgba(0,0,0,0.5)"
  blur:
    glass: "blur(20px)"
  opacity:
    muted: 0.6
    dim: 0.15

motion:
  fast: "0.15s cubic-bezier(0.4, 0, 0.2, 1)"
  smooth: "0.3s cubic-bezier(0.16, 1, 0.3, 1)"
---

# TestMate AI Design System

TestMate AI is built with a high-fidelity, premium dark aesthetic designed to evoke the feeling of a sophisticated "command center" for mobile QA professionals. The design system leverages modern web techniques like glassmorphism, procedural gradients, and neon-inspired accents to create a depth-filled, immersive interface.

## Look and Feel

### Atmospheric Depth
The application utilizes a dark background strategy using deep violets and obsidian blacks. Instead of flat colors, backgrounds use large-scale radial gradients that create a subtle sense of light sources coming from the top-left and bottom-right, suggesting a physical environment rather than a digital canvas.

### Glassmorphism & Layers
Interface components follow a "glass-first" philosophy. Sidebars, cards, and modal-like forms use semi-transparent backgrounds with high-intensity backdrop blurs (20px). This maintains a sense of hierarchy through stacking and transparency, where content feels like it's floating above the atmospheric background.

### Vibrant Accents & Light
The primary interaction color is a vibrant violet (`#8b5cf6`), chosen for its modern and energetic feel. It is complemented by a secondary cyan (`#06b6d4`) and an accent pink (`#ec4899`). These colors are often applied as linear gradients and paired with matching "glow" effects (outer shadows with low spread) to simulate light-emitting elements.

### Precision Typography
The design system uses a dual-font approach:
1. **Outfit**: A clean, geometric sans-serif used for all functional UI elements. It provides a modern, friendly but professional tone.
2. **JetBrains Mono**: Used strictly for technical data, logs, and metrics. This reinforces the "developer tool" utility of the application and ensures readability in dense data views.

## Component Language

### Cards
Cards are the primary container for content. They feature generous `24px` border radii and subtle top-edge lighting (a 1px semi-transparent white gradient) to give them a tactile, 3D quality. On hover, cards subtly scale and their "glow" intensifies, providing immediate interactive feedback.

### Navigation
The sidebar navigation uses a vertical layout with pill-shaped active states. Active items are highlighted with a primary-dim gradient and a physical vertical indicator, ensuring clear state awareness. Emojis are used as iconography to add a layer of visual interest and scannability without the weight of a custom icon set.

### Interaction States
Transitions are strictly governed by a "fast" (150ms) and "smooth" (300ms) motion profile. Buttons use pill-shaped containers with internal "sheen" animations on hover, suggesting a high level of polish. Success, warning, and danger states use industry-standard colors (green, amber, red) but are elevated with matching glows to maintain theme consistency.

### Data Visualization
Charts and live metrics (like the FPS gauge) use the primary and secondary highlights to create a high-contrast monitoring experience. Line graphs utilize smooth curves and filled gradients to emphasize trends over raw data points.
