# Club Zero

Club Zero is a full-stack e-commerce web application developed for an early-stage beverage business concept.

The platform includes product browsing, user authentication, shopping-cart functionality, checkout and order processing, Paystack payments, invoice generation, affiliate tracking, inventory management, contact forms, stockist applications, and administrative tools.

## Live Website

https://clubzero.co.za

## Key Features

- Customer registration and authentication

- Password reset functionality

- Product catalogue and product-detail pages

- Shopping cart and custom product packs

- Checkout and order processing

- Paystack payment integration

- Invoice generation and email delivery

- Affiliate applications and referral tracking

- Inventory and supplier management

- Low-stock monitoring and alerts

- Contact forms and stockist applications

- Abandoned-cart reminders

- Administrative user management

- Responsive desktop and mobile design

- PostgreSQL-backed sessions

- CSRF protection and rate limiting

## Tech Stack

### Frontend

- EJS

- HTML5

- CSS3

- Bootstrap

- JavaScript

### Backend

- Node.js

- Express.js

### Database

- PostgreSQL

- Prisma ORM

### Infrastructure and Deployment

- Docker

- Fly.io

- Fly Managed Postgres

- Git

- GitHub

### Integrations

- Paystack

- SMTP email services

### Security

- Helmet

- CSRF protection

- Rate limiting

- Secure session cookies

- PostgreSQL session storage

- Structured error logging

## My Role

I designed, developed, tested, and deployed the Club Zero application as part of a remote contract project.

My responsibilities included:

- Building responsive frontend pages using EJS, Bootstrap, HTML, CSS, and JavaScript

- Developing backend routes and application logic with Node.js and Express

- Designing and managing PostgreSQL data using Prisma

- Implementing authentication, cart, checkout, order, and payment functionality

- Building affiliate, inventory, supplier, and administrative features

- Integrating Paystack payments and email notifications

- Containerising the application with Docker

- Deploying and maintaining the application on Fly.io

- Testing, debugging, and improving application security

- Using AI-assisted development tools as part of the development workflow

## Production Notes

### Security

The application includes several production security controls:

- The app refuses to start if `DATABASE_URL` is missing

- The app refuses to start if `SESSION_SECRET` is missing or weak

- Sessions are stored in PostgreSQL

- Session cookies use `httpOnly`

- Session cookies use `sameSite=lax`

- Secure cookies are enabled automatically in production

- CSRF protection is enforced for non-GET requests

- Rate limits are applied to authentication, checkout, and contact endpoints

- Helmet provides baseline HTTP security headers

- Passwords are stored as bcrypt hashes

- Sensitive values are stored in environment variables
- 
## Repository Security

The repository must never contain:

- `.env`

- Database backups

- API keys

- Passwords

- Session secrets

- SMTP credentials

- Paystack secret keys

- Fly.io access tokens

- Real customer records

- Production database dumps

  
The `.gitignore` file excludes sensitive and generated files such as:

```gitignore

node_modules/

.env

.env.*

!.env.example

*.sql

*.dump

*.backup

.tmp*

*.exe

.DS_Store

```
## Project Status

The application is deployed and available online.

The project is no longer under active feature development, but the repository remains available as a portfolio project and technical reference.

## Licence

Copyright © 2026. All rights reserved.

This source code is provided for portfolio and demonstration purposes only. It may not be copied, modified, distributed, or used commercially without permission.

## Author

**Ettienne Janse van Vuuren**

- GitHub: https://github.com/Ettienne63

- LinkedIn: https://www.linkedin.com/in/ettienne-janse-van-vuuren-86284040b

- Live project: https://clubzero.co.za
