# Visiting (part-time) staff — simple guide

For a teacher who comes only 1 or 2 days a week (for example an accountancy teacher).

## How to add one
1. Open **Staff → Team → Add staff**.
2. Under **Type of staff** choose **Visiting**.
3. Tick the days they come (for example Tue and Thu).
4. Choose how they are paid:
   - **Per visit**: you type the amount for one visit. Pay = number of visits × that amount. A half-day visit counts as half.
   - **Fixed monthly amount**: you type one monthly amount. It is cut only when a *scheduled* visit is missed (amount × visits attended ÷ visits scheduled in the month).
5. Save.

Full-time staff are not changed in any way.

## Attendance
- On the **Attendance** tab a visiting teacher appears **only on their own days**, so they are never marked absent on other days.
- If they come on an extra day, scroll down to "Visiting staff not scheduled today" and tap their name, then mark Present. That extra visit is paid under "per visit".
- With a fixed amount, an extra visit cannot raise the pay above the fixed amount.

## Salary
- Open **Salary**. Visiting staff show "Visiting · paid per visit" or "Visiting · fixed monthly".
- Bonus, deduction, Paid/Pending, the payslip PDF and the CSV download all work as before.
- Holidays: a paid holiday on a visit day counts as a visit day under the fixed amount; an unpaid closed day is removed from the month.
- Once a month is marked Paid, its figures are locked.

## Putting it live (the new database step)
Run these inside the `worker` folder, in this order:

    npx wrangler d1 migrations apply tuition-manager-db --remote
    npx wrangler deploy

Then upload the website files again (Cloudflare Pages) and hard refresh the page (Ctrl+Shift+R) once.

The migration (`0007_visiting_staff.sql`) only ADDS columns. Existing staff and salary data stay untouched.

## What was tested
- Worker + database logic: automated tests with the real migrations on SQLite (`cd worker && npm test`).
- Salary rules: automated tests of the calculation code.
- Screens: a real browser run on a phone-size screen (add staff, attendance, extra visit, salary, paid).
- NOT tested: the real Cloudflare servers (this environment cannot reach them). Test once after deploying.
