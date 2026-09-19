import { App as AntApp, Alert, Button, Form, Input } from "antd";
import { LockOutlined, UserOutlined } from "@ant-design/icons";
import { Link, Navigate, useNavigate } from "react-router-dom";

import { ApiError } from "../api/client";
import type { Credentials } from "../api/types";
import { useMe, useRegister } from "../hooks/useAuth";
import { isRegistrationDisabled } from "../env";
import { AuthShell } from "../components/AuthShell";

/**
 * Length hints mirror the backend validators (`backend/app/constants.py` and
 * `UserRegisterSchema`); the server remains the authority and its 422/409
 * messages are surfaced as-is.
 */
export function RegisterPage() {
  const { message } = AntApp.useApp();
  const register = useRegister();
  const navigate = useNavigate();
  const { data: user } = useMe();

  if (user) {
    return <Navigate to="/portals" replace />;
  }

  // Mirrors the backend's own 403 — the signup form must not exist here at all.
  if (isRegistrationDisabled()) {
    return (
      <AuthShell title="Регистрация" footer={<Link to="/login">Войти</Link>}>
        <Alert type="error" showIcon title="Регистрация отключена" />
      </AuthShell>
    );
  }

  const onFinish = (values: Credentials) => {
    register.mutate(values, {
      onSuccess: () => {
        message.success("Учётная запись создана, выполнен вход");
        navigate("/portals", { replace: true });
      },
      onError: (error) => {
        message.error(error instanceof ApiError ? error.message : "Не удалось зарегистрироваться: сервер недоступен");
      }
    });
  };

  return (
    <AuthShell title="Регистрация" footer={<Link to="/login">Уже есть учётная запись? Войти</Link>}>
      <Form<Credentials> layout="vertical" requiredMark={false} onFinish={onFinish} disabled={register.isPending}>
        <Form.Item
          name="username"
          label="Имя пользователя"
          extra="От 4 до 64 символов"
          rules={[
            { required: true, message: "Введите имя пользователя" },
            { min: 4, max: 64, message: "Длина имени — от 4 до 64 символов" }
          ]}
        >
          <Input prefix={<UserOutlined />} autoComplete="username" autoFocus />
        </Form.Item>
        <Form.Item
          name="password"
          label="Пароль"
          extra="От 8 до 128 символов"
          rules={[
            { required: true, message: "Введите пароль" },
            { min: 8, max: 128, message: "Длина пароля — от 8 до 128 символов" }
          ]}
        >
          <Input.Password prefix={<LockOutlined />} autoComplete="new-password" />
        </Form.Item>
        <Form.Item style={{ marginBottom: 0 }}>
          <Button type="primary" htmlType="submit" block loading={register.isPending}>
            Зарегистрироваться
          </Button>
        </Form.Item>
      </Form>
    </AuthShell>
  );
}
