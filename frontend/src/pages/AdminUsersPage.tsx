import { useState } from "react";
import { DeleteOutlined, KeyOutlined, PlusOutlined } from "@ant-design/icons";
import {
  App as AntApp,
  Button,
  Card,
  Form,
  Input,
  Modal,
  Popconfirm,
  Space,
  Table,
  Tag,
} from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnsType } from "antd/es/table";

import { ApiError } from "../api/client";
import { adminApi } from "../api/endpoints";
import type { Credentials, UserOut } from "../api/types";

const USERS_QUERY_KEY = ["admin", "users"] as const;

export function AdminUsersPage() {
  const { message } = AntApp.useApp();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [passwordUser, setPasswordUser] = useState<UserOut | null>(null);
  const [createForm] = Form.useForm<Credentials>();
  const [passwordForm] = Form.useForm<{ password: string }>();

  const users = useQuery({ queryKey: USERS_QUERY_KEY, queryFn: adminApi.listUsers });

  const showError = (error: unknown) => {
    message.error(error instanceof ApiError ? error.message : "Сервер недоступен");
  };

  const createUser = useMutation({
    mutationFn: adminApi.createUser,
    onSuccess: (user) => {
      message.success(`Пользователь «${user.username}» создан`);
      setCreateOpen(false);
      createForm.resetFields();
      void queryClient.invalidateQueries({ queryKey: USERS_QUERY_KEY });
    },
    onError: showError,
  });

  const deleteUser = useMutation({
    mutationFn: adminApi.deleteUser,
    onSuccess: () => {
      message.success("Пользователь удалён");
      void queryClient.invalidateQueries({ queryKey: USERS_QUERY_KEY });
    },
    onError: showError,
  });

  const changePassword = useMutation({
    mutationFn: ({ userId, password }: { userId: number; password: string }) =>
      adminApi.setPassword(userId, password),
    onSuccess: () => {
      message.success("Пароль изменён");
      setPasswordUser(null);
      passwordForm.resetFields();
    },
    onError: showError,
  });

  const columns: ColumnsType<UserOut> = [
    { title: "ID", dataIndex: "id", key: "id", width: 90 },
    { title: "Имя пользователя", dataIndex: "username", key: "username" },
    {
      title: "Роль",
      key: "role",
      width: 200,
      render: (_, user) =>
        user.is_superuser ? <Tag color="orange">Суперпользователь</Tag> : <Tag>Оператор</Tag>,
    },
    {
      title: "",
      key: "actions",
      width: 260,
      align: "right",
      render: (_, user) => (
        <Space>
          <Button icon={<KeyOutlined />} size="small" onClick={() => setPasswordUser(user)}>
            Сменить пароль
          </Button>
          <Popconfirm
            title="Удалить пользователя?"
            description="Действие необратимо."
            okText="Удалить"
            cancelText="Отмена"
            onConfirm={() => deleteUser.mutate(user.id)}
          >
            <Button icon={<DeleteOutlined />} size="small" danger>
              Удалить
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <>
      <Card
        title="Пользователи"
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
            Создать пользователя
          </Button>
        }
      >
        {users.isError ? (
          <Button onClick={() => void users.refetch()}>Повторить загрузку</Button>
        ) : (
          <Table<UserOut>
            rowKey="id"
            columns={columns}
            dataSource={users.data ?? []}
            loading={users.isPending}
            size="medium"
            pagination={false}
          />
        )}
      </Card>

      <Modal
        open={createOpen}
        title="Создать пользователя"
        okText="Создать"
        cancelText="Отмена"
        confirmLoading={createUser.isPending}
        onCancel={() => setCreateOpen(false)}
        onOk={() => createForm.submit()}
      >
        <Form<Credentials>
          form={createForm}
          layout="vertical"
          requiredMark={false}
          onFinish={(values) => createUser.mutate(values)}
        >
          <Form.Item
            name="username"
            label="Имя пользователя"
            extra="От 4 до 64 символов"
            rules={[
              { required: true, message: "Введите имя пользователя" },
              { min: 4, max: 64, message: "Длина имени — от 4 до 64 символов" },
            ]}
          >
            <Input autoComplete="off" />
          </Form.Item>
          <Form.Item
            name="password"
            label="Пароль"
            extra="От 8 до 128 символов"
            rules={[
              { required: true, message: "Введите пароль" },
              { min: 8, max: 128, message: "Длина пароля — от 8 до 128 символов" },
            ]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={passwordUser !== null}
        title={passwordUser ? `Смена пароля: ${passwordUser.username}` : "Смена пароля"}
        okText="Сохранить"
        cancelText="Отмена"
        confirmLoading={changePassword.isPending}
        onCancel={() => setPasswordUser(null)}
        onOk={() => passwordForm.submit()}
      >
        <Form
          form={passwordForm}
          layout="vertical"
          requiredMark={false}
          onFinish={({ password }) => {
            if (passwordUser) {
              changePassword.mutate({ userId: passwordUser.id, password });
            }
          }}
        >
          <Form.Item
            name="password"
            label="Новый пароль"
            extra="От 8 до 128 символов"
            rules={[
              { required: true, message: "Введите пароль" },
              { min: 8, max: 128, message: "Длина пароля — от 8 до 128 символов" },
            ]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
