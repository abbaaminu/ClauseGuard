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
