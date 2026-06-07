# F&H Golf Course — Website

A simple, mobile-responsive static website for **F&H Golf Course** in Fleming, Colorado —
a public 9-hole course (par 36, 3,261 yards) between Fleming and Haxtun in eastern Colorado.

Plain HTML/CSS/JS. No frameworks, no build step.

## How to open

Just **double-click `index.html`** — it opens in your default web browser. No server or
install required.

## Structure

```
F-HGolf/
  index.html       Single-page site (nav, hero, course, scorecard, rates, location, contact)
  css/styles.css   All styling (green & white theme via CSS custom properties)
  js/main.js       Smooth-scroll nav + mobile hamburger toggle
  images/          Placeholder folder for course photos / logo
  README.md        This file
```

## TODO — placeholders to confirm

These values are placeholders in the code. Search for the word `PLACEHOLDER` in
`index.html` to find them quickly.

- [ ] **Scorecard pars** — per-hole pars (4,4,3,4,5,4,3,4,5) are a placeholder layout
      that sums to par 36. Confirm actual per-hole pars.
- [ ] **Hours / Season** — currently "April 1 – September 1". Confirm season + daily hours.
- [ ] **Cart fee** — currently "$14". Confirm current rate.
- [ ] **Green fees / rates** — add confirmed green fee pricing.
- [ ] **Logo** — add a logo image to `images/` and swap the text logo if desired.
- [ ] **Photos** — add course photos to `images/` (hero background, gallery, etc.).
- [ ] **Founder names** — confirm spellings of founder names in the "Our Story" section.
- [ ] **Audio (optional)** — replace `audio/fh-story.mp3` with a family/Willard human recording.

## Content Sources

The "Our Story" section and founding timeline are public history derived from
*The Story of F&H Golf Course* by founder Willard Hart.

`story.html` holds the complete founder's account in full, published with the
family's blessing, and is linked from the "Our Story" section via the
"Read the Full History" button.

`audio/fh-story.mp3` is an **auto-generated** narration of the full story
(created with the free, offline Piper TTS voice *en_US-ryan-high*). It can be
replaced later with a human recording — keep the same filename
(`audio/fh-story.mp3`) and it's a drop-in swap with no HTML changes.
`audio/narration.txt` is the lightly-normalized script used to generate it.

> ⚠️ **DO NOT publish financial-history figures, lender names, or member contribution
> amounts — those records are internal only.**

## Reference details

- Phone: (970) 774-6362
- Address: 43355 County Rd 30, Fleming, CO 80728
- Facebook: https://www.facebook.com/fandhgolf/
- Map center: lat 40.643101975582, lng -102.7566068238
