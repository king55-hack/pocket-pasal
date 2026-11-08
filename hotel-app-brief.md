# Brief: "Pocket Hotel" — hotel app for small hotels in Nepal

Start a NEW project for this. Do not edit the Pocket Pasal files. Make a new folder next to the old one:
`C:\Users\ganes\OneDrive\Desktop\Pocket Hotel` (its own git repo). You may copy ideas and code patterns from Pocket Pasal
(`C:\Users\ganes\OneDrive\Desktop\Mobile Application For Sales Management`): offline-first PWA, React + TypeScript + Vite + Dexie,
Hono on Cloudflare Workers + D1, JWT + email OTP, sync, admin page, strict CSP, tests. Read its README.md and server/README.md first.

## Who it is for
Small and medium hotels, lodges and guest houses in Nepal (5 to 60 rooms) whose owners cannot afford a big hotel system.
Owners are often not technical. Staff may share one phone or one cheap tablet. Internet is unreliable, so the app must work offline and sync later.
Nepali and English, switchable on every screen. Dates in Bikram Sambat and English. Money in Rs.

## What the owner asked for
1. Register a hotel (name, address with province/district/municipality/ward, PAN/VAT number, phone, logo, number and kinds of rooms).
2. People and roles: owner, manager, front desk/reception, housekeeping, restaurant/kitchen/waiter, other staff. Owner decides who can see and do what (prices, reports, discounts, cancel a bill, delete).
3. Rooms: room list with type, floor, bed count, price per night, status (free, booked, occupied, being cleaned, out of order).
4. Booking: phone/walk-in/online booking, dates, advance payment, cancel, no-show, a calendar/room chart that shows what is free.
5. Guest check-in and check-out: guest details, ID/passport record, number of guests, extra bed, early/late checkout, bill at checkout with room + food + extras, split payment, print/PDF/WhatsApp/email bill.
6. Restaurant/room service: menu with categories, take an order at a table or for a room, send to kitchen (screen or printed slip), mark served, add to the room bill or pay at the table.
7. Housekeeping: after checkout the room becomes "to clean"; housekeeper marks it clean; simple task list.
8. Money: cash/QR/card/bank/credit, advance, refunds, day book, who collected how much, day-end closing.
9. Reports: occupancy, income by day/month, restaurant sales, staff-wise collection, unpaid bills, export to Excel.
10. Simple for non-technical users. Big buttons, few steps, clear errors. No jargon.

## Research you must do first (the owner knows little about hotels)
Do real research (web search) before designing, and write the findings in `docs/research.md` with sources and "not sure" marks. Cover:
- How a small hotel/lodge in Nepal runs a day: reception routine, ledger/register book, housekeeping, kitchen. Look at existing products (hotel PMS for small hotels, e.g. free/cheap ones, and Nepali ones) and what they charge, what they miss.
- Rules in Nepal that affect the software: VAT and service charge on rooms and food (the usual understanding is 13% VAT and about 10% service charge, VERIFY), IRD billing rules and bill numbering, whether a hotel must use IRD-approved billing software, guest registration rules for Nepali and foreign guests (passport/visa, police reporting, "C form" or similar, VERIFY), tourist-area practices, data privacy for guest ID copies.
- Common room-rate ideas: per night, per person, with/without breakfast (CP/MAP/AP), seasonal prices, long-stay and agent commission, OTA bookings (Booking.com, Agoda) and whether to attempt a simple manual import (do NOT promise live channel manager).
- Typical mistakes and fraud in small hotels (unrecorded cash, deleted bills, double booking) and how the app can reduce them.
Then propose the smallest first version (MVP), what comes second, and what to skip. Ask the owner only questions that change the design; otherwise choose sensible defaults and say so.

## How to work (the owner's standing rules)
- Reply to the owner in simple romanized Nepali (English words only where needed). Explain plainly, admit what is untested or unsure.
- NEVER ask the owner for passwords or secret keys. The owner grants permissions but does not share passwords; tell them the command to run themselves for secrets.
- Build in steps, and keep every test green before committing or pushing: unit tests, API tests, attack-style security tests (roles cannot be bypassed, one hotel cannot see another hotel's data), and real-browser tests on phone and tablet sizes (iPhone 390x844, Android 360x780, iPad 820x1180: no sideways scroll, form fields 16px so iPhone does not zoom).
- Offline-first with conflict-safe sync: bookings and room status are the dangerous part (two phones booking the same room offline). Design this carefully, test it, and show the conflict to the manager instead of hiding it.
- Strict content security policy, no source maps, hashed passwords/PINs, per-hotel data isolation, audit trail for cancel/delete/discount/price change.
- Account closing and admin page like Pocket Pasal (owner request, admin approval, delete after a grace period).
- Email sending: support Gmail OAuth and Resend like Pocket Pasal; until configured, say clearly that email is not sent.
- Make the live URLs on Cloudflare (Workers + D1) only after the owner says yes to a deploy. Do the first deploy and git push only when asked.
- Git: commit identity Rajan Rimal, GitHub account king55-hack (noreply email), public repo, all rights reserved, commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- First message back to the owner: a short plan (research, MVP list, screens) for approval, THEN a clickable wireframe/mockup of the main screens (room chart, booking, check-in, restaurant order, checkout bill) to show hotel owners, THEN build.
