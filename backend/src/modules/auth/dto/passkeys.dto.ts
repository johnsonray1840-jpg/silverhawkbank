import { IsEmail, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class VerifyPasskeyRegistrationDto {
  @IsString()
  @IsNotEmpty()
  credentialId: string;

  @IsString()
  @IsNotEmpty()
  publicKeyPem: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  deviceName?: string;

  @IsString()
  @IsNotEmpty()
  challenge: string;
}

export class LoginPasskeyChallengeDto {
  @IsEmail()
  @IsNotEmpty()
  email: string;
}

export class VerifyPasskeyLoginDto {
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsNotEmpty()
  credentialId: string;

  @IsString()
  @IsNotEmpty()
  signature: string;

  @IsString()
  @IsNotEmpty()
  clientDataJson: string;

  @IsString()
  @IsNotEmpty()
  authenticatorData: string;
}

