# ClauseGuard

Smart contract and legal clause analysis platform powered by AI.

## Project Info

ClauseGuard is an intelligent document analysis system designed to help users understand, verify, and manage legal clauses and smart contract terms with confidence.

## Project Directory

```
├── README.md                    # Documentation
├── components.json              # Component library configuration
├── index.html                   # Entry file
├── package.json                 # Package management
├── postcss.config.js            # PostCSS configuration
├── public                       # Static resources directory
│   ├── favicon.png              # Icon
│   └── images                   # Image resources
├── src                          # Source code directory
│   ├── App.tsx                  # Entry file
│   ├── components               # Components directory
│   ├── context                  # Context directory
│   ├── db                       # Database configuration directory
│   ├── hooks                    # Common hooks directory
│   ├── index.css                # Global styles
│   ├── layout                   # Layout directory
│   ├── lib                      # Utility library directory
│   ├── main.tsx                 # Entry file
│   ├── routes.tsx               # Routing configuration
│   ├── pages                    # Pages directory
│   ├── services                 # Database interaction directory
│   ├── types                    # Type definitions directory
├── tsconfig.app.json            # TypeScript frontend configuration file
├── tsconfig.json                # TypeScript configuration file
├── tsconfig.node.json           # TypeScript Node.js configuration file
└── vite.config.ts               # Vite configuration file
```

## Tech Stack

- **Frontend**: Vite, TypeScript, React
- **Backend**: Supabase
- **UI Components**: Radix UI, TailwindCSS
- **Forms**: React Hook Form, Zod
- **Charts**: Recharts
- **Icons**: Lucide React

## Development Guidelines

### How to edit code locally?

You can use [VSCode](https://code.visualstudio.com/Download) or any IDE you prefer. The only requirement is to have Node.js and npm installed.

### Environment Requirements

```
Node.js ≥ 20
npm ≥ 10

Example versions:
- node -v   # v20.18.3
- npm -v    # 10.8.2
```

### Installing Node.js on Windows

```
1. Visit the Node.js official website: https://nodejs.org/
2. Download the appropriate version (the website will suggest 32-bit or 64-bit)
3. Run the installer by double-clicking the downloaded file
4. Follow the installation wizard to complete the process
5. Verify installation by opening Command Prompt and running:
   - node -v
   - npm -v
```

### Installing Node.js on macOS

**Using Homebrew (Recommended):**
```bash
brew install node
```

**Or using the official installer:**
1. Visit https://nodejs.org/
2. Download the macOS .pkg installer
3. Open the downloaded file and follow the prompts
4. Verify installation in Terminal:
   ```bash
   node -v
   npm -v
   ```

### Getting Started

After installing Node.js and npm, follow these steps:

```bash
# 1. Clone/download the code repository
# 2. Extract the code package if needed
# 3. Open the code directory in your IDE
# 4. Install dependencies
npm install

# 5. Start the development server
npm run dev -- --host 127.0.0.1

# If the above command fails, try:
npx vite --host 127.0.0.1
```

### Backend Development

To develop backend services:
1. Configure environment variables
2. Install relevant dependencies
3. For database needs, use Supabase (https://supabase.com/)

## Trial, subscriptions, and usage enforcement

New organizations receive three audit credits automatically and do not need to
enter payment details. The database reserves a credit when a contract is
created and reserves another credit for each re-analysis. Usage limits are
organization-wide and enforced by Supabase functions, not only by the UI.

| Plan | Monthly price | Monthly audits | Included features |
| --- | ---: | ---: | --- |
| Free trial | $0 | 3 total | Standard playbooks, TXT/PDF extraction |
| Starter | $5 | 25 | Standard playbooks, TXT/PDF extraction, PDF reports |
| Pro | $15 | 150 | Custom weighted playbooks, team collaboration, priority PDF reports, DOCX extraction |

To enable subscriptions:

1. Create monthly Starter and Pro prices in Paddle. Set the frontend build
   variables `VITE_PADDLE_CLIENT_TOKEN`, `VITE_PADDLE_ENVIRONMENT` (`production`
   by default; use `sandbox` only for testing), `VITE_PADDLE_STARTER_PRICE_ID`,
   and `VITE_PADDLE_PRO_PRICE_ID`.
2. Configure Supabase function secrets:
   `PADDLE_WEBHOOK_SECRET`, `PADDLE_CONTEXT_SECRET`,
   `PADDLE_API_KEY`, `PADDLE_ENVIRONMENT`, `PADDLE_STARTER_PRICE_ID`, and
   `PADDLE_PRO_PRICE_ID`. The Paddle price IDs must match the frontend values.
3. Apply database migrations with `supabase db push` and deploy
   `paddle-checkout-context`, `change-paddle-plan`, and `paddle-webhook`.
4. Register
   `https://<project-ref>.supabase.co/functions/v1/paddle-webhook` as a Paddle
   notification destination for subscription created, updated, activated,
   resumed, paused, and canceled events. Copy its notification secret to
   `PADDLE_WEBHOOK_SECRET`.

The checkout context function signs each organization's ID before it is
included in Paddle metadata; the webhook verifies both that signature and the
Paddle event signature before changing subscription entitlements. Never put
either signing secret in a frontend environment variable.

Audit reports use the browser print dialog; choose **Save as PDF** to download
the branded report without uploading contract data to a PDF conversion
service.

## Features

- AI-powered clause analysis
- Smart contract verification
- Legal document insights
- Real-time analysis and feedback
- Secure document handling

## Contributing

We welcome contributions! Please feel free to submit pull requests or open issues for bugs and feature requests.

## License

[Add your license here]

## Support

For issues and questions, please open an issue on the GitHub repository.
