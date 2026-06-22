UI Layout & System Design Specification
1. Color Palette (Ayu-Dark Inspired)
Primary Background: Deep, matte navy/charcoal (#0B0E14 or similar dark theme canvas).

Secondary Block Background: Slightly lighter charcoal-blue (#141923) for containers.

Typography (Body): Off-white / light gray (#B3B1AD) for high readability without glare.

Accent Color 1 (Action/Headers): Vibrant warm orange (#FF9F43) for main headings and user input boundaries.

Accent Color 2 (Technical/Links): Soft bright cyan/blue (#5CCFE6) for variables and file paths.

Accent Color 3 (Success/Status): Lime/Sage green (#A6CC70) for completed actions and file states.

Muted Text: Medium slate gray (#5C6773) for comments and secondary metadata.

2. Structural Layout & Typography Hierarchy
Font Family: Global monospace font (e.g., Fira Code, JetBrains Mono) across both prose and code blocks to maintain a cohesive engineering-first feel.

Global Header: A thin, full-width horizontal rule separates top metadata (e.g., model name left-aligned, theme name right-aligned in muted text) from the main content.

User Input Block:

Enclosed in a distinct, full-width container block with a slightly lighter background than the canvas.

Features a solid, vertical orange accent line (3-4px) bounding the entire left edge.

Preceded by a small, muted "You" label.

Content Sectioning:

Headings: Use a large font size in the primary accent color (Orange) preceded by markdown hashes (##).

Prose Text: Regular weight, off-white, utilizing inline code styling (light background tint or cyan text color) for technical terms.

3. Code Block Design
Container: A rounded-corner card spanning the content width, filled with a deep dark background.

Syntax Highlighting Style:

Keywords (export, function, return, let, for): Bright orange or purple.

Types & Variables (number, n, seq): Alternating soft cyan and light pink.

Comments (//...): Muted slate gray.

Brackets & Operators: Light gray/white.

4. Status and Lists
Action/Status Bar: A full-width horizontal banner signaling a file mutation (e.g., "Edit src/utils.ts"). It features a solid green vertical accent line on the left, a green checkmark icon on the right, and uses the success green accent color for the text.

Key-Value Bullet Points: A standard bulleted list at the bottom for summaries, using small orange bullet points, regular off-white text, and inline cyan code blocks for variables.