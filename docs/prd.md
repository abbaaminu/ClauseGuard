# Requirements Document

## 1. Application Overview

### 1.1 Application Name
ClauseGuard

### 1.2 Application Description
A contract analyzer and compliance auditor designed for corporate lawyers to upload legal contracts and run automated audits against regulatory templates and corporate playbooks. The system identifies compliance risks, missing clauses, and deviations, providing alternative suggestions for safer contract language.

## 2. Users and Usage Scenarios

### 2.1 Target Users
Corporate lawyers, legal compliance officers, and contract management teams in enterprise organizations.

### 2.2 Core Usage Scenarios
- Upload legal contracts for compliance review
- Execute automated audits against predefined regulatory standards
- Review audit results with highlighted risks and alternative clause suggestions
- Manage and customize compliance playbooks for organizational standards

## 3. Page Structure and Functional Description

### 3.1 Page Hierarchy

```
ClauseGuard Application
├── Authentication
│   ├── Registration Page
│   └── Login Page
├── Dashboard Page (/dashboard)
├── Audit Workspace Page (/contracts/[id])
└── Playbook Manager Page (/playbooks)
```

### 3.2 Registration Page

**Purpose**: Allow new users to create accounts.

**Core Elements**:
- Email input field
- Password input field
- Organization name input field
- Submit button to complete registration

### 3.3 Login Page

**Purpose**: Allow existing users to access the application.

**Core Elements**:
- Email input field
- Password input field
- Submit button to authenticate and enter dashboard

### 3.4 Dashboard Page

**Purpose**: Central hub for contract management and overview analytics.

**Functional Modules**:

#### 3.4.1 File Upload Zone
- Support drag-and-drop file upload
- Accept PDF and DOCX file formats
- Display visual feedback during drag operation
- Show loading indicator during file processing
- Trigger audit execution upon successful upload

#### 3.4.2 Contract List Table
- Display all uploaded contracts in paginated table format
- Show columns: File Name, Upload Date, Playbook Used, Risk Score, Audit Status
- Risk Score displayed with color-coded badge (0-30: Green, 31-70: Orange, 71-100: Red)
- Audit Status shows current processing state (uploaded, processing, completed, failed)
- Clicking a contract row navigates to Audit Workspace Page

#### 3.4.3 Analytics Metrics
- Display metric card: Total Audited Contracts (count of completed audits)
- Display metric card: Average Risk Score (calculated across all completed contracts)
- Display metric card: Critical Flags Pending (count of high-severity unresolved issues)

### 3.5 Audit Workspace Page

**Purpose**: Detailed review interface for individual contract audit results.

**Layout Structure**: Two-column layout

#### 3.5.1 Left Column: Document Viewer
- Display contract content in readable text format
- Support scrolling through full document
- Highlight specific sections when corresponding audit item is selected in right column

#### 3.5.2 Right Column: Audit Results Sidebar
- Organize audit findings into categorized accordion sections:
  - Critical Risks
  - Missing Clauses
  - Deviations
- Each audit item displays:
  - Category label (e.g., Indemnification, Governing Law)
  - Status indicator (passed, flagged, missing)
  - Critical level badge (low, medium, high)
  - Exact contract snippet (quoted text from original document)
  - Violation description
  - Alternative suggestion (safer clause phrasing)
  - Copy button to copy alternative suggestion text
- Clicking an audit item scrolls and highlights corresponding section in left column document viewer

### 3.6 Playbook Manager Page

**Purpose**: Manage compliance templates and custom audit rules.

**Functional Modules**:

#### 3.6.1 Standard Playbook Selection
- Display list of predefined compliance profiles (e.g., GDPR Compliance Checklist, Standard Vendor NDA Guidelines)
- Allow user to select playbook for use in contract audits

#### 3.6.2 Custom Playbook Creation
- Form to create new custom playbook
- Input field: Playbook name
- Text area: Custom rule definitions (e.g., Governing law must strictly be state of Delaware. Flag any other jurisdiction.)
- Save button to store custom playbook

#### 3.6.3 Playbook List Management
- Display all user-created custom playbooks
- Edit button to modify existing playbook rules
- Delete button to remove playbook

## 4. Business Rules and Logic

### 4.1 Contract Upload and Processing
- System accepts only PDF and DOCX file formats
- Upon upload, contract status is set to uploaded
- System initiates automated audit process, changing status to processing
- After audit completion, status changes to completed
- If processing fails, status changes to failed

### 4.2 Audit Execution Logic
- System extracts text content from uploaded contract file
- System applies selected playbook rules to contract content
- For each rule, system searches for matching clauses in contract
- If matching clause found, system evaluates compliance:
  - If compliant: mark as passed
  - If non-compliant: mark as flagged, extract exact snippet, generate alternative suggestion
- If no matching clause found: mark as missing
- System assigns critical level (low, medium, high) based on rule severity
- System calculates overall risk score (0-100) based on flagged and missing items

### 4.3 Risk Score Calculation
- Risk score is integer value from 0 to 100
- Score increases based on:
  - Number of flagged items
  - Number of missing critical clauses
  - Critical level weighting (high > medium > low)
- Score of 0-30 indicates low risk
- Score of 31-70 indicates medium risk
- Score of 71-100 indicates high risk

### 4.4 Document Highlighting Synchronization
- When user clicks audit item in right sidebar, system identifies corresponding text location in document
- System scrolls document viewer to bring highlighted section into view
- Highlighted section remains visible until user selects different audit item

### 4.5 Playbook Application
- User must select playbook before uploading contract, or select default playbook
- Selected playbook rules are applied during audit execution
- Each contract audit is associated with specific playbook used

## 5. Exceptions and Boundary Conditions

| Scenario | System Behavior |
|----------|------------------|
| User uploads unsupported file format | Display error message, reject upload |
| File upload fails due to network issue | Display error message, allow retry |
| Audit processing exceeds timeout limit | Set contract status to failed, notify user |
| Contract contains no text content | Mark audit as failed, display message indicating unreadable document |
| User attempts to delete playbook currently in use | Display warning, prevent deletion |
| No playbook selected during upload | Apply default standard playbook |
| Audit finds zero issues | Display risk score of 0, show message indicating full compliance |
| User clicks audit item but corresponding text not found in document | Display message indicating section reference unavailable |

## 6. Acceptance Criteria

1. User completes registration with email, password, and organization name
2. User logs in and accesses Dashboard Page
3. User uploads a contract file (PDF or DOCX) via drag-and-drop upload zone
4. System processes contract and displays completed audit in contract list table with risk score and status
5. User clicks contract row to open Audit Workspace Page
6. User reviews audit results in right sidebar, clicks a flagged item, and sees corresponding contract section highlighted in left document viewer
7. User copies alternative suggestion text using copy button
8. User navigates to Playbook Manager Page and creates a custom playbook with specific rule

## 7. Out of Scope for Current Release

- Multi-language contract support (only English contracts)
- Batch upload of multiple contracts simultaneously
- Export audit reports to PDF or Word format
- Email notifications for audit completion
- User role management and permission controls
- Contract version comparison
- Collaborative review features (comments, annotations)
- Integration with external document management systems
- Mobile application interface
- Advanced analytics dashboards with trend analysis
- Automated contract redlining or editing
- Contract template library
- Audit history tracking and change logs