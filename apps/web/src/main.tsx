import React from "react";
import ReactDOM from "react-dom/client";
import { CircleParking, LoaderCircle } from "lucide-react";
import { AuthProvider, useAuth } from "./auth";
import { DashboardPage } from "./pages/DashboardPage";
import { LoginPage } from "./pages/LoginPage";
import { RegisterPage } from "./pages/RegisterPage";
import "./styles.css";

function navigate(path: string) {
  window.history.replaceState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function App() {
  const { user, checkingSession } = useAuth();
  const [path, setPath] = React.useState(window.location.pathname);

  React.useEffect(() => {
    const handleNavigation = () => setPath(window.location.pathname);
    window.addEventListener("popstate", handleNavigation);
    return () => window.removeEventListener("popstate", handleNavigation);
  }, []);

  React.useEffect(() => {
    if (checkingSession) return;
    if (path.startsWith("/dashboard") && !user) navigate("/login");
    if ((path === "/login" || path === "/register") && user)
      navigate("/dashboard");
    if (
      !["/login", "/register", "/dashboard"].some((route) =>
        path.startsWith(route),
      )
    ) {
      navigate(user ? "/dashboard" : "/login");
    }
  }, [checkingSession, path, user]);

  if (checkingSession) {
    return (
      <div className="app-splash">
        <CircleParking />
        <LoaderCircle className="spin" />
        <span>Đang kiểm tra phiên đăng nhập</span>
      </div>
    );
  }
  if (path === "/login" && !user) return <LoginPage />;
  if (path === "/register" && !user) return <RegisterPage />;
  if (path.startsWith("/dashboard") && user) return <DashboardPage />;
  return null;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </React.StrictMode>,
);
