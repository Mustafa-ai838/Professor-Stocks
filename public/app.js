const form = document.querySelector("#auth-form");
const nameField = document.querySelector("#name-field");
const nameInput = document.querySelector("#name");
const emailField = document.querySelector("#email").closest(".field");
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

let supabaseClient;
let isSignup = false;
let isRecovery = false;

document.querySelector("#year").textContent = new Date().getFullYear();
submitButton.disabled = true;

function showMessage(message, type = "error") {
  statusMessage.textContent = message;
  statusMessage.classList.toggle("success", type === "success");
}

function setMode(signup) {
  isSignup = signup;
  isRecovery = false;
  title.textContent = signup ? "Create your account" : "Welcome back";
  subtitle.textContent = signup
    ? "Sign up to start building your PSX watchlist."
    : "Sign in to view your watchlist and alerts.";
  nameField.hidden = !signup;
  nameInput.required = signup;
  emailField.hidden = false;
  emailInput.required = true;
  emailInput.autocomplete = "email";
  passwordInput.autocomplete = signup ? "new-password" : "current-password";
  passwordHint.hidden = !signup;
  passwordInput.required = true;
  forgotPasswordButton.hidden = signup;
  submitButton.textContent = signup ? "Create account" : "Sign in";
  switchMode.firstChild.textContent = signup
    ? "Already have an account? "
    : "Don't have an account? ";
  modeButton.textContent = signup ? "Sign in" : "Sign up";
  switchMode.hidden = false;
  showMessage("");
}

function setSignedOut() {
  form.hidden = false;
  document.querySelector(".divider").hidden = false;
  googleButton.hidden = false;
  switchMode.hidden = false;
  signedInPanel.hidden = true;
  submitButton.disabled = false;
  setMode(false);
}

function setSignedIn(user) {
  form.hidden = true;
  document.querySelector(".divider").hidden = true;
  googleButton.hidden = true;
  switchMode.hidden = true;
  signedInPanel.hidden = false;
  title.textContent = `Welcome, ${user.user_metadata?.name || user.email}`;
  subtitle.textContent = "You're signed in to Professor Stocks.";
  userEmail.textContent = user.email || "";
}

function startPasswordRecovery() {
  isRecovery = true;
  title.textContent = "Choose a new password";
  subtitle.textContent = "Enter a new password for your account.";
  nameField.hidden = true;
  nameInput.required = false;
  emailField.hidden = true;
  emailInput.required = false;
  passwordInput.value = "";
  passwordInput.autocomplete = "new-password";
  passwordHint.hidden = true;
  passwordInput.required = true;
  forgotPasswordButton.hidden = true;
  submitButton.textContent = "Update password";
  switchMode.hidden = true;
  showMessage("");
}

async function initializeSupabase() {
  if (!window.supabase?.createClient) {
    showMessage("Supabase SDK could not load. Run npm install and restart the app.");
    return;
  }

  try {
    const response = await fetch("/api/config");
    if (!response.ok) throw new Error(`Configuration request failed (${response.status}).`);
    const config = await response.json();
    if (!config.configured) {
      showMessage("Supabase is not configured. Add your project URL and publishable key to .env, then restart the app.");
      return;
    }

    supabaseClient = window.supabase.createClient(config.supabaseUrl, config.publishableKey);
    submitButton.disabled = false;

    supabaseClient.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") {
        startPasswordRecovery();
      } else if (session?.user) {
        setSignedIn(session.user);
      } else if (event === "SIGNED_OUT") {
        setSignedOut();
      }
    });
  } catch (error) {
    showMessage(error.message || "Could not connect to Supabase. Check your .env settings and restart.");
  }
}

modeButton.addEventListener("click", () => setMode(!isSignup));

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  showMessage("");

  if (!form.reportValidity() || !supabaseClient) return;
  submitButton.disabled = true;
  let passwordWasUpdated = false;

  try {
    if (isRecovery) {
      submitButton.textContent = "Updating password...";
      const { error } = await supabaseClient.auth.updateUser({ password: passwordInput.value });
      if (error) throw error;
      isRecovery = false;
      passwordWasUpdated = true;
      passwordInput.value = "";
      showMessage("Your password has been updated.", "success");
      submitButton.textContent = "Password updated";
      return;
    }

    if (isSignup) {
      submitButton.textContent = "Creating account...";
      const { data, error } = await supabaseClient.auth.signUp({
        email: emailInput.value.trim(),
        password: passwordInput.value,
        options: { data: { name: nameInput.value.trim() } },
      });
      if (error) throw error;

      if (data.session) {
        setSignedIn(data.user);
      } else {
        showMessage("Account created. Check your email to confirm your address, then sign in.", "success");
        passwordInput.value = "";
      }
      return;
    }

    submitButton.textContent = "Signing in...";
    const { data, error } = await supabaseClient.auth.signInWithPassword({
      email: emailInput.value.trim(),
      password: passwordInput.value,
    });
    if (error) throw error;
    setSignedIn(data.user);
  } catch (error) {
    showMessage(error.message || "Authentication failed. Please try again.");
  } finally {
    submitButton.disabled = false;
    if (!passwordWasUpdated) {
      submitButton.textContent = isRecovery ? "Update password" : isSignup ? "Create account" : "Sign in";
    }
  }
});

logoutButton.addEventListener("click", async () => {
  logoutButton.disabled = true;
  try {
    const { error } = await supabaseClient.auth.signOut();
    if (error) throw error;
  } catch (error) {
    showMessage(error.message || "Could not sign out. Please try again.");
  } finally {
    logoutButton.disabled = false;
  }
});

forgotPasswordButton.addEventListener("click", async () => {
  const email = emailInput.value.trim();
  if (!emailInput.validity.valid || !email) {
    emailInput.reportValidity();
    emailInput.focus();
    return;
  }

  forgotPasswordButton.disabled = true;
  try {
    const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin,
    });
    if (error) throw error;
    showMessage("If an account exists for this email, a password reset link is on its way.", "success");
  } catch (error) {
    showMessage(error.message || "Could not send the password reset email.");
  } finally {
    forgotPasswordButton.disabled = false;
  }
});

googleButton.addEventListener("click", async () => {
  googleButton.disabled = true;
  try {
    const { error } = await supabaseClient.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
    if (error) throw error;
  } catch (error) {
    showMessage(error.message || "Google sign-in could not be started.");
  } finally {
    googleButton.disabled = false;
  }
});

if (new URLSearchParams(window.location.search).get("mode") === "signup") {
  setMode(true);
}

initializeSupabase();
