import { App as AntApp, Button, Form, Input } from "antd";
import { LockOutlined, UserOutlined } from "@ant-design/icons";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";

import { ApiError } from "../api/client";
import type { Credentials } from "../api/types";
import { useLogin, useMe } from "../hooks/useAuth";
import { AuthShell } from "../components/AuthShell";

interface LocationState {
  from?: string;
}

export function LoginPage() {
  const { message } = AntApp.useApp();
  const login = useLogin();
  const navigate = useNavigate();
  const location = useLocation();
  const { data: user } = useMe();

  const from = (location.state as LocationState | null)?.from ?? "/portals";

  if (user) {
    return <Navigate to="/portals" replace />;
  }

  const onFinish = (values: Credentials) => {
    login.mutate(values, {
      onSuccess: () => {
        message.success("Вход выполнен");
        navigate(from, { replace: true });
      },
      onError: (error) => {
        message.error(
          error instanceof ApiError ? error.message : "Не удалось войти: сервер недоступен",
        );
      },
    });
  };

  return (
    <AuthShell
      title="Вход"
      footer={<Link to="/register">Нет учётной записи? Зарегистрироваться</Link>}
    >
      <Form<Credentials>
        layout="vertical"
        requiredMark={false}
        onFinish={onFinish}
        disabled={login.isPending}
      >
        <Form.Item
          name="username"
          label="Имя пользователя"
          rules={[{ required: true, message: "Введите имя пользователя" }]}
        >
          <Input prefix={<UserOutlined />} autoComplete="username" autoFocus />
        </Form.Item>
        <Form.Item
          name="password"
          label="Пароль"
          rules={[{ required: true, message: "Введите пароль" }]}
        >
          <Input.Password prefix={<LockOutlined />} autoComplete="current-password" />
        </Form.Item>
        <Form.Item style={{ marginBottom: 0 }}>
          <Button type="primary" htmlType="submit" block loading={login.isPending}>
            Войти
          </Button>
        </Form.Item>
      </Form>
    </AuthShell>
  );
}
