const form = document.querySelector("#auth-form");
const nameField = document.querySelector("#name-field");
const nameInput = document.querySelector("#name");
const emailInput = document.querySelector("#email");
const passwordInput = document.querySelector("#password");
const passwordHint = document.querySelector("#password-hint");
const title = document.querySelector("#form-title");
const subtitle = document.querySelector("#form-subtitle");
const submitButton = document.querySelector("#submit-button");
const modeButton = document.querySelector("#mode-button");
const switchMode = document.querySelector("#switch-mode");
const statusMessage = document.querySelector("#status-message");
const signedInPanel = document.querySelector("#signed-in");
const userEmail = document.querySelector("#user-email");
const logoutButton = document.querySelector("#logout-button");
const forgotPasswordButton = document.querySelector("#forgot-password");
const googleButton = document.querySelector("#google-button");

let isSignup = false;

document.querySelector("#year").textContent = new Date().getFullYear();

function showMessage(message, type = "error") {
  statusMessage.textContent = message;
  statusMessage.classList.toggle("success", type === "success");
}

function setMode(signup) {
  isSignup = signup;
  title.textContent = signup ? "Create your account" : "Welcome back";
  subtitle.textContent = signup
    ? "Sign up to start building your PSX watchlist."
    : "Sign in to view your watchlist and alerts.";
  nameField.hidden = !signup;
  nameInput.required = signup;
  passwordInput.autocomplete = signup ? "new-password" : "current-password";
  passwordHint.hidden = !signup;
  submitButton.textContent = signup ? "Create account" : "Sign in";
  switchMode.firstChild.textContent = signup
    ? "Already have an account? "
    : "Don't have an account? ";
  modeButton.textContent = signup ? "Sign in" : "Sign up";
  showMessage("");
}

function setSignedIn(user) {
  form.hidden = true;
  document.querySelector(".divider").hidden = true;
  googleButton.hidden = true;
  switchMode.hidden = true;
  signedInPanel.hidden = false;
  title.textContent = `Welcome, ${user.name}`;
  subtitle.textContent = "You're signed in to Professor Stocks.";
  userEmail.textContent = user.email;
}

async function requestJson(path, body) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Request failed. Please try again.");
  return result;
}

modeButton.addEventListener("click", () => setMode(!isSignup));

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  showMessage("");

  if (!form.reportValidity()) return;
  submitButton.disabled = true;
  submitButton.textContent = isSignup ? "Creating account..." : "Signing in...";

  try {
    const result = await requestJson(isSignup ? "/api/register" : "/api/login", {
      name: nameInput.value,
      email: emailInput.value,
      password: passwordInput.value,
    });
    setSignedIn(result.user);
  } catch (error) {
    showMessage(error.message);
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = isSignup ? "Create account" : "Sign in";
  }
});

logoutButton.addEventListener("click", async () => {
  logoutButton.disabled = true;
  try {
    await requestJson("/api/logout", {});
    signedInPanel.hidden = true;
    form.hidden = false;
    document.querySelector(".divider").hidden = false;
    googleButton.hidden = false;
    switchMode.hidden = false;
    passwordInput.value = "";
    setMode(false);
  } catch (error) {
    showMessage(error.message);
  } finally {
    logoutButton.disabled = false;
  }
});

forgotPasswordButton.addEventListener("click", () => {
  showMessage("Email password reset needs an email service. Please contact the site admin for now.");
});

googleButton.addEventListener("click", () => {
  showMessage("Google sign-in needs OAuth credentials. Configure Google OAuth to enable it.");
});

fetch("/api/me")
  .then((response) => response.json())
  .then(({ user }) => {
    if (user) setSignedIn(user);
  })
  .catch(() => showMessage("Could not connect to the server. Please refresh the page."));
