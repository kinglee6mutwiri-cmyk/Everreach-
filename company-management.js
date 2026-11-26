const sections = {
  pending: {
    list: "pendingCompanies",
    count: "pendingCount"
  },
  approved: {
    list: "approvedCompanies",
    count: "approvedCount"
  },
  rejected: {
    list: "rejectedCompanies",
    count: "rejectedCount"
  },
  suspended: {
    list: "suspendedCompanies",
    count: "suspendedCount"
  }
};

async function companyRequest(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    cache: "no-store",
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  const data = await response.json();

  if (response.status === 401) {
    window.location.replace("/login.html");
    throw new Error("Administrator login required.");
  }

  if (response.status === 403) {
    window.location.replace("/dashboard.html");
    throw new Error("Administrator access required.");
  }

  if (!response.ok || !data.ok) {
    throw new Error(data.error || "Company request failed.");
  }

  return data;
}

function addCompanyText(parent, label, value) {
  const p = document.createElement("p");
  p.textContent = label + ": " + (value || "-");
  parent.appendChild(p);
}

function createCompanyCard(company, status) {
  const card = document.createElement("div");
  card.className = "company-item";

  const heading = document.createElement("h4");
  heading.textContent = company.display_name || company.legal_name;
  card.appendChild(heading);

  addCompanyText(card, "Legal name", company.legal_name);
  addCompanyText(card, "Owner email", company.owner_email);
  addCompanyText(card, "Country", company.country_code);
  addCompanyText(card, "Base currency", company.base_currency);
  addCompanyText(card, "Registration number", company.registration_number);
  addCompanyText(card, "Phone", company.contact_phone);
  addCompanyText(card, "Website", company.website);
  addCompanyText(card, "Submitted", company.created_at);
  addCompanyText(card, "Status", company.verification_status);

  if (status === "rejected") {
    addCompanyText(card, "Rejection reason", company.rejection_reason);
  }

  if (status === "approved" || status === "rejected") {
    addCompanyText(card, "Reviewed by", company.reviewed_by);
    addCompanyText(card, "Reviewed at", company.reviewed_at);
  }

  if (status === "pending") {
    const actions = document.createElement("div");
    actions.className = "company-actions";

    const approve = document.createElement("button");
    approve.className = "approve-btn";
    approve.textContent = "Approve";

    approve.addEventListener("click", async () => {
      if (!confirm("Approve this company application?")) return;

      approve.disabled = true;

      try {
        const result = await companyRequest(
          "/api/admin/companies/approve",
          {
            method: "POST",
            body: JSON.stringify({ companyId: company.id })
          }
        );

        alert(result.message);
        await loadCompanies();
      } catch (error) {
        alert(error.message);
        approve.disabled = false;
      }
    });

    const reject = document.createElement("button");
    reject.className = "reject-btn";
    reject.textContent = "Reject";

    reject.addEventListener("click", async () => {
      const reason = prompt(
        "Enter the reason for rejecting this company application:"
      );

      if (reason === null) return;

      if (reason.trim().length < 5 || reason.trim().length > 500) {
        alert("The rejection reason must contain 5 to 500 characters.");
        return;
      }

      reject.disabled = true;

      try {
        const result = await companyRequest(
          "/api/admin/companies/reject",
          {
            method: "POST",
            body: JSON.stringify({
              companyId: company.id,
              reason: reason.trim()
            })
          }
        );

        alert(result.message);
        await loadCompanies();
      } catch (error) {
        alert(error.message);
        reject.disabled = false;
      }
    });

    actions.append(approve, reject);
    card.appendChild(actions);
  }

  return card;
}

async function loadCompanyStatus(status) {
  const section = sections[status];
  const container = document.getElementById(section.list);
  const counter = document.getElementById(section.count);

  container.textContent = "Loading companies...";

  try {
    const data = await companyRequest(
      "/api/admin/companies?status=" + encodeURIComponent(status)
    );

    const companies = data.companies || [];
    counter.textContent = String(companies.length);

    if (!companies.length) {
      const empty = document.createElement("p");
      empty.className = "company-empty";
      empty.textContent = "No companies in this section.";
      container.replaceChildren(empty);
      return;
    }

    const fragment = document.createDocumentFragment();

    companies.forEach(company => {
      fragment.appendChild(createCompanyCard(company, status));
    });

    container.replaceChildren(fragment);
  } catch (error) {
    container.textContent = error.message;
    counter.textContent = "!";
  }
}

async function loadCompanies() {
  await Promise.all(
    Object.keys(sections).map(status => loadCompanyStatus(status))
  );
}

loadCompanies();
