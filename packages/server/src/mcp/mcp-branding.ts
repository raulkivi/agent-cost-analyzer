// What every product serving the MCP tools shows about where it comes
// from: the repo link and the icon. Inline data URIs, so clients show the
// icon without the server or the client reaching the network.

export const MCP_WEBSITE_URL = "https://github.com/raulkivi/agent-cost-analyzer";

// packages/vscode-extension/icon.svg, without its comment.
const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 24 24">
  <rect width="24" height="24" rx="5" fill="#5980a6" />
  <g transform="translate(3.2 3.6) scale(0.7)" fill="none" stroke="#ffffff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
    <path d="M4 20V10" />
    <path d="M10 20V4" />
    <path d="M16 20v-7" />
    <path d="M21 20H3" />
  </g>
</svg>
`;

// The same icon rendered for clients without SVG support, which the spec
// lets them leave out: rsvg-convert -w 64 -h 64 icon.svg | base64 -w0.
const ICON_PNG_64_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAABmJLR0QA/wD/AP+gvaeTAAAESUlEQVR4nO2bS0xcVRjHf+fMvcMMw0MKlFdquyhUsWp8pK0S4yPdKKhNlMhDxZUBiY1pdFMTuahho3GhUaKGqA0v2UqbNDbqwnRVbUy6UZqYJjhAsabEgnTmzhwXgA5lYJjrzD1XmN9qzrnnm+9//nPnzPnu5AhS0Nw3Vm5E7SYUjUAdUAHsTBWnicvADPCzQJ1UiPERq+33jQLEehea3x6r8dmxXoF6AfBlVqdr2MDnCtEzarWGkw1IakBL70i3UOodIJhNdW4hUAsIXh3uae9fey2Bh6xvjWrCHyhEp3vy3EMh+qepPPqd9bC90mckDqhk+v2tOnkAgeqqYkoB3St9cuVFS+9It0B1aVHmLi+19Q79M08B0GKNVEviEwqRr0+Xq/wlidcNWc9OSgCBemsbTR4gGEe+ASCa+8bKjYgd5ob1YBtgm/5opfRFYo+z/SYPYESjZpMEGnUr0YaiSQpUrW4dGtkrgSrdKjRSLYFS3So0Ui7ZoCDKJME8kx2FnisthCurf8Pte3jxiQOYho/zv/zGe19+TywedyN1SmTqIf8NAXQ8ejemsVRR31VXwz37arKddtNk3QC/6aMgmLeqb0eRdzadWTcgGcKVVWdzaDHAS+QM0C1ANzkDdAvQTc4A3QJ043grfP/+3bQcvhOA0TM/cfbCpYyJchNHd0BRKEDnkUOUFYcoKw7ReeQQRaFAprW5giMDqkoLMXz/hho+SVVpYcZEuYkjA5LtZD20u02Lbb8IetKA6rIiDty6i5sKsv8AxXOPww/W7+LlpxuQQrBwPYo18DWTs3NZy+e5O+Cx+25BLtfL+Xkmh+/dm9V8njMgP+Bf1Q7e0M40njPAbXIG6Bagm5wBugXoJmeAbgG6yRmgW4BuHNUCO0sK1vTV76mgOEnxYhprPd5dWcLB+puTvncwz1zVLisOrTvWjsWZnJ1j5o8/NyM7KaLVGlbpBDzzyB08+cBtjhNmGqUUAyfP8c0PFx3Fp/UVCPgNmhrqHSXKFkIInnpwv+P4tAyIxZVn/tdPJGLHHMemZUDUjjF4+rynTFiM2Aye/tFxfNqL4JlzE5y9cImKkhCh5VJ1fjGaMi7PbxAwfczNX08tyicozA9w9doiSq2/RNmxOLNXr7EYsdcdkzIXoEjzmebCYoRfpyKOk3oIJYENj5RscS5LYEq3Co2EJTChW4U+xEUpUOO6ZehCCb6SCjHO0umq7UbUb0ZOyeVzdZ/pVuM2AjVw4njHFQmgEBYwr1eSq8xLM/4mLO8ER63WsBDqNb2a3EOgjg2+/twUJGyFh3va+xVizcHCrYZAfThstX+y0l5VC0xTeXSLm/BRmOpXEjuSboHbeoe6ULy7hU6SzQvUscRPfoWk1eBwT3t/HFkLfMr/+yfSBj72mbHaZJOHTRRBz/d9URqNmk0o0QhqH0vH5ysyLDRTzADTLB+fN/z2yRPHO65sFPA3XFgTn8g25XwAAAAASUVORK5CYII=";

export const MCP_ICONS = [
  { src: `data:image/svg+xml;base64,${Buffer.from(ICON_SVG).toString("base64")}`, mimeType: "image/svg+xml", sizes: ["any"] },
  { src: `data:image/png;base64,${ICON_PNG_64_BASE64}`, mimeType: "image/png", sizes: ["64x64"] },
];
