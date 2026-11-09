import asyncio, json, sys
from pathlib import Path
from playwright.async_api import async_playwright

OUT = Path("/tmp/training/shots")
OUT.mkdir(parents=True, exist_ok=True)
SESS = json.load(open("/tmp/training/sessions.json"))
KEY = "sb-xbebvphvtdesgabrgyrp-auth-token"
BASE = "http://localhost:8080"
PHOTO = "/tmp/training/sample_photo.jpg"

L = {
    "en": dict(clock_in="Clock in", unsched="Clock in without a scheduled job", sop="View SOP", arrived="Arrived", leaving="Leaving",
               lunch="Start unpaid lunch", end_lunch="End lunch / Resume work", sched="My schedule", ts="My timesheet", mark="Mark SOP reviewed"),
    "uk": dict(clock_in="Почати зміну", unsched="Clock in without a scheduled job", sop="Переглянути інструкцію", arrived="Arrived", leaving="Leaving",
               lunch="Start unpaid lunch", end_lunch="End lunch / Resume work", sched="Мій графік", ts="Мій табель", mark="Позначити інструкцію переглянутою"),
}

async def shot(page, lang, name, wait=900):
    await page.wait_for_timeout(wait)
    await page.add_style_tag(content="button[aria-label='Ask WRRCS']{display:none!important}")
    await page.screenshot(path=str(OUT / f"{lang}_{name}.png"))
    print("shot", lang, name, flush=True)

async def run(who, lang):
    t = L[lang]
    async with async_playwright() as p:
        b = await p.chromium.launch(headless=True)
        ctx = await b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True, timezone_id="America/Los_Angeles", locale="en-US")
        page = await ctx.new_page()
        page.on("dialog", lambda d: asyncio.ensure_future(d.accept()))
        errs = []
        page.on("pageerror", lambda e: errs.append(str(e)))
        await page.goto(BASE + "/auth", wait_until="networkidle")
        await page.evaluate("(l) => localStorage.setItem('wrrcs.lang', l)", lang)
        await page.get_by_label("Email").fill(f"training.{who}@example.com")
        await page.get_by_label("Password", exact=True).fill(json.load(open("/tmp/training/demo.json"))["pw"])
        await page.get_by_role("button", name="Sign in", exact=True).click()
        await page.wait_for_url("**/my-jobs**", timeout=30000)
        await page.goto(BASE + "/my-jobs", wait_until="networkidle")
        await page.wait_for_timeout(2500)
        await shot(page, lang, "01_myjobs")
        # unscheduled clock-in dialog
        await page.get_by_role("button", name=t["unsched"]).click()
        await shot(page, lang, "02_unscheduled", 600)
        await page.keyboard.press("Escape")
        await page.wait_for_timeout(400)
        # clock in for the day via next appointment
        hero = page.locator("section.rounded-2xl").first
        await hero.get_by_role("button", name=t["clock_in"], exact=True).click()
        await page.wait_for_timeout(3500)
        await hero.scroll_into_view_if_needed()
        await page.evaluate("window.scrollBy(0,-80)")
        await shot(page, lang, "03_clocked_in", 2500)
        # SOP
        await hero.get_by_role("button", name=t["sop"]).click()
        await page.wait_for_timeout(2500)
        await shot(page, lang, "04_sop")
        await page.keyboard.press("Escape")
        await page.wait_for_timeout(500)
        # Leaving dialog with a sample photo
        await hero.get_by_role("button", name=t["leaving"], exact=True).click()
        await page.wait_for_timeout(1200)
        inputs = page.locator("input[type=file]")
        if await inputs.count():
            await inputs.last.set_input_files(PHOTO)
        await shot(page, lang, "04b_leaving", 1200)
        await page.get_by_role("button", name="Cancel").or_(page.get_by_role("button", name="Скасувати")).first.click()
        await page.wait_for_timeout(600)
        # lunch
        await page.get_by_role("button", name=t["lunch"]).click()
        await page.wait_for_timeout(2000)
        await page.evaluate("window.scrollTo(0,0)")
        await shot(page, lang, "04c_lunch")
        await page.get_by_role("button", name=t["end_lunch"]).click()
        await page.wait_for_timeout(2500)
        # leave job 1 (no photos) to show drive time + Arrived on the next job
        await hero.get_by_role("button", name=t["leaving"], exact=True).click()
        await page.wait_for_timeout(1000)
        await page.locator("div.fixed.inset-0").get_by_role("button", name=t["leaving"], exact=True).click()
        await page.wait_for_timeout(4000)
        await page.evaluate("window.scrollTo(0,0)")
        await shot(page, lang, "05_driving", 1500)
        await hero.get_by_role("button", name=t["arrived"], exact=True).evaluate("el => el.scrollIntoView({block:'center'})")
        await shot(page, lang, "05b_arrive_next", 1500)
        # schedule & timesheet tabs
        await page.get_by_role("button", name=t["sched"]).click()
        await shot(page, lang, "08_schedule", 2000)
        await page.get_by_role("button", name=t["ts"]).click()
        await shot(page, lang, "09_timesheet", 2000)
        for path, name in [("/timesheet", "10_timesheet_page"), ("/caddies", "11_caddy"), ("/time-off", "12_timeoff"), ("/team", "13_team"), ("/tips", "14_tips"), ("/settings/language", "15_language"), ("/calendar", "16_calendar")]:
            await page.goto(BASE + path, wait_until="networkidle")
            if name == "11_caddy":
                await page.wait_for_timeout(2000)
                await page.locator("main button").filter(has_text="(").first.click()
            await shot(page, lang, name, 2500)
        print("errors:", errs[:5])
        await b.close()

async def main():
    which = sys.argv[1:] or ["maria:en", "oksana:uk"]
    for w in which:
        who, lang = w.split(":")
        await run(who, lang)

asyncio.run(main())
