# PixelForge Pro

PixelForge Pro is a web UI for Stable Diffusion backends such as Automatic1111 and compatible `sdapi` servers.

[Launch App](https://milak-web.github.io/ai-image-generator/)

## Features

- Prompt-first interface with mobile-friendly layout
- Stable Diffusion txt2img generation
- History strip and prompt history
- RP automation tools
- Hires fix controls

## Connection Modes

The app now supports two reliable routes:

1. Direct Mode
Use this for public endpoints that already expose the Stable Diffusion API and allow CORS from `https://milak-web.github.io`.

2. Local Bridge Mode
Use this for localhost, LAN targets, and public endpoints that block browser CORS.

## Using The Local Bridge

1. Start your Stable Diffusion backend normally.
2. Run [Start Local Bridge.cmd](<C:\Users\MK2\Desktop\PRO\ai-image-generator\Start Local Bridge.cmd>).
3. Open the app.
4. Paste your backend URL.
5. Leave `Direct Mode` turned off.

The bridge listens on `http://127.0.0.1:8000` and proxies requests from the GitHub Pages app to your chosen backend URL.

Examples:

- `http://127.0.0.1:7860`
- `http://192.168.1.25:7860`
- `https://your-public-link.example.com`

## Automatic1111 Notes

Make sure your backend exposes the API:

```bat
--api
```

If you want browser-direct mode from GitHub Pages, also allow your site origin:

```bat
--cors-allow-origins https://milak-web.github.io
```

## License

MIT
