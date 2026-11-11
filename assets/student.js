// Student page: find your name, see your stamp cards, add stars with a code.

const app = $("#app");
const switchBtn = $("#switch");
const STORAGE_KEY = "starpoints.student";

let studentId = null;

function remembered() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}
function remember(id) {
  try {
    if (id) localStorage.setItem(STORAGE_KEY, JSON.stringify(id));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage unavailable: just don't remember */
  }
}

// ---------- Search screen ----------

function showSearch() {
  studentId = null;
  remember(null);
  switchBtn.hidden = true;

  const results = h("div", { class: "results" });
  const input = h("input", {
    id: "search",
    type: "search",
    placeholder: "Type your name…",
    autocomplete: "off",
  });

  let timer;
  let latest = 0;
  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const q = input.value.trim();
      const mine = ++latest;
      if (!q) return results.replaceChildren();
      try {
        const list = await rpc("search_students", { p_query: q });
        if (mine !== latest) return;
        results.replaceChildren(
          ...(list.length
            ? list.map((s) =>
                h(
                  "button",
                  { type: "button", onclick: () => openStudent(s.id) },
                  h("span", {}, s.name),
                  h("span", { class: "pill" }, `★ ${s.stars}`)
                )
              )
            : [h("p", { class: "empty" }, "No student with that name. Ask your teacher to add you.")])
        );
      } catch (e) {
        if (mine === latest) results.replaceChildren(h("p", { class: "empty" }, e.message));
      }
    }, 250);
  });

  app.replaceChildren(
    h(
      "section",
      { class: "panel" },
      h("h2", {}, "Find your name"),
      h("label", { for: "search" }, "Your name"),
      input,
      results
    )
  );
  input.focus();
}

// ---------- Student screen ----------

async function openStudent(id) {
  studentId = id;
  try {
    render(await rpc("student_view", { p_student_id: id }));
    remember(id);
    switchBtn.hidden = false;
  } catch (e) {
    toast(e.message, "err");
    showSearch();
  }
}

async function refresh() {
  if (studentId == null) return;
  try {
    render(await rpc("student_view", { p_student_id: studentId }));
  } catch {
    /* keep showing the last good view */
  }
}

function render(view) {
  const { student, rewards, requests } = view;
  const stars = student.stars;
  const available = stars - view.pending_stars;
  const fullCards = Math.floor(stars / 10);
  const onCurrent = stars % 10;

  // Keep whatever the student was typing when the page refreshes itself.
  const typedCode = $("#code") ? $("#code").value : "";
  const typedStars = $("#stars") ? $("#stars").value : "";
  const focusedId = document.activeElement && document.activeElement.id;

  // --- Stars + stamp cards
  const shownFull = Math.min(fullCards, 12);
  const hero = h(
    "section",
    { class: "panel hero" },
    h("div", { class: "name" }, student.name),
    h("div", { class: "total" }, `★ ${stars} `, h("small", {}, stars === 1 ? "star" : "stars")),
    h(
      "p",
      { class: "muted" },
      fullCards
        ? `${plural(fullCards, "full card")} · ${onCurrent} of 10 stamps on your next card`
        : `${onCurrent} of 10 stamps on your card`
    ),
    stampCard(onCurrent),
    fullCards
      ? h(
          "div",
          { class: "full-cards" },
          Array.from({ length: shownFull }, () => stampCard(10, { small: true })),
          fullCards > shownFull ? h("span", { class: "pill" }, `+${fullCards - shownFull} more`) : null
        )
      : null
  );

  // --- Add stars with a code
  const codeInput = h("input", {
    id: "code",
    placeholder: "ABC123",
    autocomplete: "off",
    autocapitalize: "characters",
    maxlength: "12",
    required: true,
    value: typedCode,
  });
  const starsInput = h("input", {
    id: "stars",
    type: "number",
    inputmode: "numeric",
    min: "1",
    max: "100",
    placeholder: "1",
    required: true,
    value: typedStars,
  });
  const addBtn = h("button", { type: "submit" }, "Add stars");
  const addForm = h(
    "form",
    {
      class: "row",
      onsubmit: async (ev) => {
        ev.preventDefault();
        addBtn.disabled = true;
        try {
          const out = await rpc("claim_code", {
            p_student_id: studentId,
            p_code: codeInput.value,
            p_stars: parseInt(starsInput.value, 10),
          });
          codeInput.value = "";
          starsInput.value = "";
          toast(`Added ${plural(out.added, "star")}! You now have ${out.stars}.`);
          await refresh();
        } catch (e) {
          toast(e.message, "err");
        } finally {
          addBtn.disabled = false;
        }
      },
    },
    h("div", { class: "grow" }, h("label", { for: "code" }, "Teacher's code"), codeInput),
    h("div", { class: "narrow" }, h("label", { for: "stars" }, "How many stars"), starsInput),
    addBtn
  );
  const addPanel = h(
    "section",
    { class: "panel" },
    h("h2", {}, "Add stars"),
    h("p", { class: "muted" }, "Type the code your teacher shows you and the number of stars they tell you."),
    addForm
  );

  // --- Rewards
  const rewardItems = rewards.map((r) => {
    const canGet = available >= r.cost;
    const pct = Math.min(100, Math.round((Math.max(available, 0) / r.cost) * 100));
    return h(
      "li",
      { class: "reward" },
      h(
        "div",
        { class: "main" },
        h("strong", {}, r.name),
        " ",
        h("span", { class: "pill" }, `★ ${r.cost}`),
        canGet
          ? null
          : h("div", { class: "muted" }, `${plural(r.cost - Math.max(available, 0), "more star")} to go`),
        canGet ? null : h("div", { class: "progress" }, h("i", { style: `width:${pct}%` }))
      ),
      h(
        "button",
        {
          type: "button",
          class: "small",
          disabled: !canGet,
          onclick: async (ev) => {
            if (!confirm(`Ask your teacher for "${r.name}" (${plural(r.cost, "star")})?`)) return;
            ev.target.disabled = true;
            try {
              await rpc("request_reward", { p_student_id: studentId, p_reward_id: r.id });
              toast("Request sent! Your teacher will approve it.");
            } catch (e) {
              toast(e.message, "err");
            }
            await refresh();
          },
        },
        "Redeem"
      )
    );
  });
  const rewardsPanel = h(
    "section",
    { class: "panel" },
    h("h2", {}, "Rewards"),
    view.pending_stars
      ? h("p", { class: "muted" }, `${plural(view.pending_stars, "star")} waiting for your teacher to approve.`)
      : h("p", { class: "muted" }, "Redeem now, or keep collecting for a bigger reward."),
    rewards.length
      ? h("ul", { class: "list" }, rewardItems)
      : h("p", { class: "empty" }, "Your teacher has not added any rewards yet.")
  );

  // --- My requests
  const statusText = { pending: "Waiting", approved: "Approved", rejected: "Not approved" };
  const requestsPanel = requests.length
    ? h(
        "section",
        { class: "panel" },
        h("h2", {}, "My reward requests"),
        h(
          "ul",
          { class: "list" },
          requests.map((q) =>
            h(
              "li",
              {},
              h("div", { class: "main" }, h("strong", {}, q.reward_name), h("div", { class: "muted" }, `★ ${q.cost} · ${timeAgo(q.created_at)}`)),
              h("span", { class: `pill ${q.status}` }, statusText[q.status])
            )
          )
        )
      )
    : null;

  app.replaceChildren(hero, addPanel, rewardsPanel, ...(requestsPanel ? [requestsPanel] : []));
  if (focusedId === "code" || focusedId === "stars") $("#" + focusedId).focus();
}

// ---------- Start ----------

switchBtn.addEventListener("click", showSearch);

if (!isConfigured()) {
  showSetupNotice(app);
} else {
  const saved = remembered();
  if (saved != null) openStudent(saved);
  else showSearch();
  // Pick up teacher approvals without the student needing to reload.
  setInterval(() => {
    if (!document.hidden) refresh();
  }, 20000);
}
