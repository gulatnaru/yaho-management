import { beforeEach, describe, expect, it, vi } from "vitest";

const { CredentialsSigninMock, signInMock } = vi.hoisted(() => {
  class ExpectedCredentialsSignin extends Error {}
  return { CredentialsSigninMock: ExpectedCredentialsSignin, signInMock: vi.fn() };
});

vi.mock("@/auth", () => ({ signIn: signInMock }));
vi.mock("next-auth", () => ({ CredentialsSignin: CredentialsSigninMock }));

import { loginAction } from "@/app/(auth)/login/actions";

function validLoginForm() {
  const formData = new FormData();
  formData.set("email", "operator@yaho.test");
  formData.set("password", "valid-password");
  return formData;
}

describe("loginAction", () => {
  beforeEach(() => {
    signInMock.mockReset();
  });

  it("keeps the existing generic message for expected credential rejection", async () => {
    signInMock.mockRejectedValue(new CredentialsSigninMock());

    await expect(loginAction({}, validLoginForm())).resolves.toEqual({
      error: "이메일 또는 비밀번호가 올바르지 않습니다.",
    });
  });

  it("rethrows callback and infrastructure failures", async () => {
    const infrastructureError = new Error("database query failed");
    signInMock.mockRejectedValue(infrastructureError);

    await expect(loginAction({}, validLoginForm())).rejects.toBe(infrastructureError);
  });

  it("does not call Auth.js when credential input is invalid", async () => {
    const formData = new FormData();
    formData.set("email", "invalid");
    formData.set("password", "short");

    await expect(loginAction({}, formData)).resolves.toEqual({
      error: "이메일과 비밀번호를 확인해 주세요.",
    });
    expect(signInMock).not.toHaveBeenCalled();
  });
});
